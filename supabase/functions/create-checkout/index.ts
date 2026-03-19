// supabase/functions/create-checkout/index.ts
// Deploy: supabase functions deploy create-checkout
// Check logs: supabase functions logs create-checkout --scroll

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function ok(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: CORS });
}
function err(msg, status) {
  console.error("ERROR", status, msg);
  return new Response(JSON.stringify({ error: msg }), { status: status || 500, headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Log every request so we can see what's happening ──────
  console.log("create-checkout invoked:", req.method);

  try {
    // ── Env var check (log which ones are missing) ────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId     = Deno.env.get("STRIPE_PRICE_ID");
    const appUrl      = Deno.env.get("APP_URL") || "https://tradezona.vercel.app";

    console.log("Env check — SUPABASE_URL:", !!supabaseUrl, "| SERVICE_KEY:", !!serviceKey, "| STRIPE_KEY:", !!stripeKey, "| PRICE_ID:", !!priceId, "| priceId value starts with:", priceId ? priceId.slice(0, 8) : "MISSING");

    if (!supabaseUrl) return err("SUPABASE_URL not set", 500);
    if (!serviceKey)  return err("SUPABASE_SERVICE_ROLE_KEY not set", 500);
    if (!stripeKey)   return err("STRIPE_SECRET_KEY not set", 500);
    if (!priceId)     return err("STRIPE_PRICE_ID not set — set it with: supabase secrets set STRIPE_PRICE_ID=price_xxx", 500);

    // Price IDs must start with "price_" not "prod_"
    if (!priceId.startsWith("price_")) {
      return err("STRIPE_PRICE_ID looks wrong — it should start with 'price_', not 'prod_'. Find it in Stripe Dashboard → Products → your product → click the price → copy the Price ID", 500);
    }

    // ── Authenticate ──────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return err("No Authorization header", 401);

    const token = authHeader.replace("Bearer ", "").trim();
    console.log("Token length:", token.length);

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "Authorization": `Bearer ${token}`, "apikey": serviceKey },
    });
    const userData = await userRes.json();
    console.log("Auth status:", userRes.status, "| user id:", userData.id || "NONE");

    if (!userData.id) return err("Auth failed: " + (userData.message || userData.error_description || JSON.stringify(userData)), 401);

    const userId    = userData.id;
    const userEmail = userData.email;

    // ── Get profile ───────────────────────────────────────────
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=plan,stripe_customer_id`,
      { headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Accept": "application/json" } }
    );
    const profileBody = await profileRes.text();
    console.log("Profile response:", profileRes.status, profileBody.slice(0, 200));

    let plan = null;
    let customerId = null;
    try {
      const profiles = JSON.parse(profileBody);
      if (Array.isArray(profiles) && profiles[0]) {
        plan       = profiles[0].plan || null;
        customerId = profiles[0].stripe_customer_id || null;
      }
    } catch (_) {}

    console.log("Plan:", plan, "| customerId:", customerId ? customerId.slice(0, 8) + "..." : "none");

    if (plan === "pro") return err("Already on Pro", 400);

    // ── Create Stripe customer if needed ──────────────────────
    if (!customerId) {
      console.log("Creating Stripe customer for:", userEmail);
      const custRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: `email=${encodeURIComponent(userEmail)}&metadata[supabase_user_id]=${userId}`,
      });
      const cust = await custRes.json();
      console.log("Stripe customer:", custRes.status, "id:", cust.id, "error:", cust.error?.message);

      if (!cust.id) return err("Stripe customer error: " + (cust.error?.message || JSON.stringify(cust)), 500);
      customerId = cust.id;

      // Save to profile (best-effort)
      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ stripe_customer_id: customerId }),
      });
    }

    // ── Create checkout session ───────────────────────────────
    console.log("Creating session — price:", priceId, "| customer:", customerId);
    const sessionBody = new URLSearchParams();
    sessionBody.set("customer",                 customerId);
    sessionBody.set("mode",                     "subscription");
    sessionBody.set("line_items[0][price]",     priceId);
    sessionBody.set("line_items[0][quantity]",  "1");
    sessionBody.set("success_url",              `${appUrl}/subscription?upgraded=1`);
    sessionBody.set("cancel_url",               `${appUrl}/subscription?cancelled=1`);
    sessionBody.set("metadata[supabase_user_id]", userId);

    const sessRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: sessionBody.toString(),
    });
    const sess = await sessRes.json();
    console.log("Session result:", sessRes.status, "| url:", sess.url ? "ok" : "MISSING", "| error:", sess.error?.message || "none");

    if (!sess.url) return err("Stripe session failed: " + (sess.error?.message || sess.error?.code || JSON.stringify(sess)), 500);

    return ok({ url: sess.url });

  } catch (e) {
    console.error("FATAL EXCEPTION:", e.message, e.stack);
    return err(e.message || "Internal server error", 500);
  }
});