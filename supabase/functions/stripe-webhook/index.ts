// supabase/functions/stripe-webhook/index.ts
//
// FIXED & ENHANCED — handles plan upgrades, renewals, cancellations,
// and triggers referral reward on first successful subscription.
//
// Deploy: supabase functions deploy stripe-webhook
// Required secrets (supabase secrets set):
//   STRIPE_WEBHOOK_SECRET
//   STRIPE_SECRET_KEY
//   SUPABASE_URL         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno&no-check";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

// ── Supabase admin client (bypasses RLS) ─────────────────
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Helpers ───────────────────────────────────────────────

function detectPlanType(sub: Stripe.Subscription): "monthly" | "yearly" | "lifetime" {
  const item     = sub.items?.data?.[0];
  const interval = item?.price?.recurring?.interval;
  if (!interval)          return "monthly";
  if (interval === "year") return "yearly";
  return "monthly";
}

function calcExpiresAt(sub: Stripe.Subscription, planType: string): string {
  if (sub.current_period_end) {
    return new Date(sub.current_period_end * 1000).toISOString();
  }
  const days   = planType === "yearly" ? 365 : 30;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry.toISOString();
}

/**
 * Find the Supabase user ID from a Stripe session.
 * Priority: session.metadata.supabase_user_id → customer email lookup
 */
async function resolveUserId(
  session: Stripe.CheckoutSession
): Promise<string | null> {
  // 1. Prefer metadata (most reliable)
  if (session.metadata?.supabase_user_id) {
    return session.metadata.supabase_user_id;
  }

  // 2. Fallback: look up by email via auth admin API
  const email = session.customer_details?.email ?? session.customer_email;
  if (email) {
    console.log(`[webhook] Trying email lookup for: ${email}`);
    const { data, error } = await supabase.auth.admin.listUsers();
    if (!error && data?.users) {
      const match = data.users.find(u => u.email === email);
      if (match) return match.id;
    }
  }

  return null;
}

/** Trigger referral reward for the newly subscribed user (fire-and-forget) */
async function triggerReferralReward(userId: string): Promise<void> {
  try {
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/grant-referral-reward`,
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:  `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ referred_user_id: userId }),
      }
    );
    const result = await res.json();
    console.log(`[webhook] grant-referral-reward for ${userId}:`, result);
  } catch (e) {
    console.error(`[webhook] grant-referral-reward failed for ${userId}:`, e);
  }
}

// ── Main handler ──────────────────────────────────────────
serve(async (req) => {
  const sig  = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig!,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`[webhook] Event: ${event.type}`);

  try {
    switch (event.type) {

      // ── ① Checkout completed ─────────────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.CheckoutSession;
        const userId  = await resolveUserId(session);

        if (!userId) {
          console.error("[webhook] checkout.session.completed: cannot resolve user — missing supabase_user_id in metadata and no email match");
          break;
        }

        let planType: "monthly" | "yearly" | "lifetime" = "monthly";
        let expiresAt: string | null = null;

        if (session.mode === "payment") {
          // One-time payment → lifetime
          planType  = "lifetime";
          expiresAt = null;
        } else if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            planType  = detectPlanType(sub);
            expiresAt = calcExpiresAt(sub, planType);
          } catch (e) {
            console.error("[webhook] Could not retrieve subscription:", e);
            const meta = session.metadata?.plan_type;
            if (meta === "yearly") planType = "yearly";
            const days = planType === "yearly" ? 365 : 30;
            const d = new Date();
            d.setDate(d.getDate() + days);
            expiresAt = d.toISOString();
          }
        }

        const { error } = await supabase.from("profiles").update({
          plan:                    "pro",
          plan_type:               planType,
          stripe_customer_id:      session.customer as string ?? null,
          stripe_subscription_id:  session.subscription as string ?? null,
          subscription_expires_at: expiresAt,
        }).eq("id", userId);

        if (error) {
          console.error(`[webhook] Profile update failed for ${userId}:`, error);
        } else {
          console.log(`[webhook] ✅ Upgraded ${userId} → Pro (${planType}, expires: ${expiresAt})`);
        }

        // Trigger referral reward (new subscriber)
        await triggerReferralReward(userId);
        break;
      }

      // ── ② Subscription deleted (cancelled) ───────────────
      case "customer.subscription.deleted": {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        const { error } = await supabase.from("profiles").update({
          plan:                    "free",
          plan_type:               "none",
          stripe_subscription_id:  null,
          subscription_expires_at: null,
        }).eq("stripe_customer_id", customerId);

        if (error) console.error(`[webhook] Downgrade failed for customer ${customerId}:`, error);
        else console.log(`[webhook] Downgraded customer ${customerId} to Free`);
        break;
      }

      // ── ③ Subscription updated (plan change / renewal) ───
      case "customer.subscription.updated": {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const isActive   = ["active", "trialing"].includes(sub.status);
        const planType   = detectPlanType(sub);
        const expiresAt  = isActive && sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { error } = await supabase.from("profiles").update({
          plan:                    isActive ? "pro"  : "free",
          plan_type:               isActive ? planType : "none",
          subscription_expires_at: isActive ? expiresAt : null,
        }).eq("stripe_customer_id", customerId);

        if (error) console.error(`[webhook] subscription.updated failed for ${customerId}:`, error);
        else console.log(`[webhook] Updated ${customerId} → ${isActive ? "pro/" + planType : "free"}`);
        break;
      }

      // ── ④ Invoice paid (renewal keeps expiry fresh) ───────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        try {
          const sub        = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const customerId = sub.customer as string;
          const planType   = detectPlanType(sub);
          const expiresAt  = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;

          const { error } = await supabase.from("profiles").update({
            plan:                    "pro",
            plan_type:               planType,
            subscription_expires_at: expiresAt,
          }).eq("stripe_customer_id", customerId);

          if (error) console.error(`[webhook] Renewal update failed for ${customerId}:`, error);
          else console.log(`[webhook] Renewed ${customerId} (${planType}, expires: ${expiresAt})`);
        } catch (e) {
          console.error("[webhook] invoice.payment_succeeded error:", e);
        }
        break;
      }

      // ── ⑤ Invoice payment failed ─────────────────────────
      case "invoice.payment_failed": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        // Optional: mark as past_due but don't fully downgrade yet
        console.warn(`[webhook] ⚠️ Payment failed for customer ${customerId}`);
        break;
      }

      default:
        console.log(`[webhook] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    console.error("[webhook] Processing error:", err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});