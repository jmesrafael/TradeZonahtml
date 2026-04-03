// supabase/functions/grant-referral-reward/index.ts
//
// FIXED & ENHANCED — grants the referrer +30 days Pro when their referred
// user first subscribes. Called internally by stripe-webhook.
//
// Deploy: supabase functions deploy grant-referral-reward
// Internal only — requires service role key in Authorization header.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REWARD_DAYS = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { referred_user_id } = await req.json();

    if (!referred_user_id) {
      return new Response(JSON.stringify({ error: "Missing referred_user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    console.log(`[grant-reward] Processing reward for referred_user_id: ${referred_user_id}`);

    // ── 1. Find pending referral row ─────────────────────
    const { data: referral, error: refErr } = await supabase
      .from("referrals")
      .select("id, referrer_id, reward_granted, status")
      .eq("referred_user_id", referred_user_id)
      .maybeSingle();

    if (refErr) {
      console.error("[grant-reward] DB error:", refErr);
      return new Response(JSON.stringify({ error: "DB error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!referral) {
      console.log(`[grant-reward] No referral found for ${referred_user_id} — skipping`);
      return new Response(JSON.stringify({ skipped: true, reason: "no_referral_found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (referral.reward_granted) {
      console.log(`[grant-reward] Reward already granted for referral ${referral.id}`);
      return new Response(JSON.stringify({ skipped: true, reason: "already_rewarded" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 2. Get referrer's current profile ─────────────────
    const { data: referrerProfile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, plan, plan_type, subscription_expires_at, referral_count")
      .eq("id", referral.referrer_id)
      .single();

    if (profileErr || !referrerProfile) {
      console.error(`[grant-reward] Referrer ${referral.referrer_id} not found:`, profileErr);
      return new Response(JSON.stringify({ error: "Referrer not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Calculate new expiry ───────────────────────────
    const now      = new Date();
    let   baseDate = now;

    if (referrerProfile.subscription_expires_at) {
      const existing = new Date(referrerProfile.subscription_expires_at);
      if (existing > now) baseDate = existing; // Extend from future expiry
    }

    const newExpiry = new Date(baseDate);
    newExpiry.setDate(newExpiry.getDate() + REWARD_DAYS);

    console.log(`[grant-reward] New expiry for ${referral.referrer_id}: ${newExpiry.toISOString()}`);

    // ── 4. Update referrer profile ────────────────────────
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({
        plan:                    "pro",
        plan_type:               referrerProfile.plan_type === "none" ? "monthly" : referrerProfile.plan_type,
        subscription_expires_at: newExpiry.toISOString(),
        referral_count:          (referrerProfile.referral_count || 0) + 1,
      })
      .eq("id", referral.referrer_id);

    if (updateErr) {
      console.error(`[grant-reward] Profile update failed:`, updateErr);
      return new Response(JSON.stringify({ error: "Profile update failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 5. Mark referral as rewarded ──────────────────────
    const { error: markErr } = await supabase
      .from("referrals")
      .update({ status: "rewarded", reward_granted: true })
      .eq("id", referral.id);

    if (markErr) {
      console.error(`[grant-reward] Mark rewarded failed (non-fatal):`, markErr);
    }

    console.log(`[grant-reward] ✅ Granted ${REWARD_DAYS} days Pro to ${referral.referrer_id}. New expiry: ${newExpiry.toISOString()}`);

    return new Response(
      JSON.stringify({
        success:      true,
        referrer_id:  referral.referrer_id,
        days_granted: REWARD_DAYS,
        new_expiry:   newExpiry.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[grant-reward] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});