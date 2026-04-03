// supabase/functions/stripe-webhook/index.ts
// Deploy: supabase functions deploy stripe-webhook
// Required secrets: STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno&no-check";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ── Helpers ───────────────────────────────────────────────

function detectPlanType(sub: Stripe.Subscription): "monthly" | "yearly" {
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
  return interval === "year" ? "yearly" : "monthly";
}

function calcExpiresAt(sub: Stripe.Subscription): string {
  if (sub.current_period_end) {
    return new Date(sub.current_period_end * 1000).toISOString();
  }
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
}

async function resolveUserId(session: Stripe.CheckoutSession): Promise<string | null> {
  if (session.metadata?.supabase_user_id) return session.metadata.supabase_user_id;

  const email = session.customer_details?.email ?? session.customer_email;
  if (email) {
    const { data } = await supabase.auth.admin.listUsers();
    const match = data?.users?.find(u => u.email === email);
    if (match) return match.id;
  }
  return null;
}

async function triggerReferralReward(userId: string): Promise<void> {
  try {
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/grant-referral-reward`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ referred_user_id: userId }),
      }
    );
    const result = await res.json();
    console.log(`[webhook] grant-referral-reward for ${userId}:`, result);
  } catch (e) {
    console.error(`[webhook] grant-referral-reward failed:`, e);
  }
}

// ── Main ──────────────────────────────────────────────────

serve(async (req) => {
  const sig  = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body, sig!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`[webhook] Event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Checkout completed (new subscription) ─────────────
      case "checkout.session.completed": {
        const session  = event.data.object as Stripe.CheckoutSession;
        const userId   = await resolveUserId(session);

        if (!userId) {
          console.error("[webhook] Cannot resolve user ID");
          break;
        }

        let planType: "monthly" | "yearly" = "monthly";
        let expiresAt: string | null = null;

        if (session.subscription) {
          try {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            planType  = detectPlanType(sub);
            expiresAt = calcExpiresAt(sub);
          } catch (e) {
            console.error("[webhook] Could not retrieve subscription:", e);
            // Fallback from metadata
            const meta = session.metadata?.plan_type;
            planType  = meta === "yearly" ? "yearly" : "monthly";
            const d   = new Date();
            d.setDate(d.getDate() + (planType === "yearly" ? 365 : 30));
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

        // Trigger referral reward
        await triggerReferralReward(userId);
        break;
      }

      // ── Invoice paid — renewal, keep expiry fresh ─────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        try {
          const sub        = await stripe.subscriptions.retrieve(invoice.subscription as string);
          const customerId = sub.customer as string;
          const planType   = detectPlanType(sub);
          const expiresAt  = calcExpiresAt(sub);

          // Only update if the subscription is active (auto-renew)
          if (["active", "trialing"].includes(sub.status)) {
            const { error } = await supabase.from("profiles").update({
              plan:                    "pro",
              plan_type:               planType,
              subscription_expires_at: expiresAt,
            }).eq("stripe_customer_id", customerId);

            if (error) console.error(`[webhook] Renewal update failed:`, error);
            else console.log(`[webhook] Renewed ${customerId} (${planType}, expires: ${expiresAt})`);
          }
        } catch (e) {
          console.error("[webhook] invoice.payment_succeeded error:", e);
        }
        break;
      }

      // ── Subscription updated ──────────────────────────────
      case "customer.subscription.updated": {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const isActive   = ["active", "trialing"].includes(sub.status);
        const planType   = detectPlanType(sub);
        const expiresAt  = isActive && sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { error } = await supabase.from("profiles").update({
          plan:                    isActive ? "pro" : "free",
          plan_type:               isActive ? planType : "none",
          subscription_expires_at: isActive ? expiresAt : null,
          stripe_subscription_id:  isActive ? sub.id : null,
        }).eq("stripe_customer_id", customerId);

        if (error) console.error(`[webhook] subscription.updated failed:`, error);
        else console.log(`[webhook] Updated ${customerId} → ${isActive ? "pro/" + planType : "free"}`);
        break;
      }

      // ── Subscription cancelled ────────────────────────────
      case "customer.subscription.deleted": {
        const sub        = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // When subscription is deleted, downgrade to free immediately
        const { error } = await supabase.from("profiles").update({
          plan:                    "free",
          plan_type:               "none",
          stripe_subscription_id:  null,
          subscription_expires_at: null,
        }).eq("stripe_customer_id", customerId);

        if (error) console.error(`[webhook] Downgrade failed:`, error);
        else console.log(`[webhook] Downgraded ${customerId} → Free`);
        break;
      }

      // ── Payment failed ────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice    = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.warn(`[webhook] ⚠️ Payment failed for ${customerId}`);
        // Don't downgrade immediately — Stripe retries. 
        // subscription.deleted fires if all retries fail.
        break;
      }

      default:
        console.log(`[webhook] Unhandled: ${event.type}`);
    }
  } catch (err) {
    console.error("[webhook] Processing error:", err);
    return new Response("Internal error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});