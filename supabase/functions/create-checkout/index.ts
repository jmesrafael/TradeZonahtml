// supabase/functions/create-checkout/index.ts
// Deploy: supabase functions deploy create-checkout

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

function ok(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: CORS });
}
function fail(msg, status) {
  console.error("ERROR", status, msg);
  return new Response(JSON.stringify({ error: msg }), { status: status || 500, headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  console.log("create-checkout called");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeKey   = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId     = Deno.env.get("STRIPE_PRICE_ID");
    const appUrl      = Deno.env.get("APP_URL") || "https://tradezona.vercel.app";

    console.log("Env — url:", !!supabaseUrl, "svc:", !!serviceKey, "stripe:", !!stripeKey, "price:", priceId?.slice(0,10));

    if (!supabaseUrl) return fail("SUPABASE_URL not set", 500);
    if (!serviceKey)  return fail("SUPABASE_SERVICE_ROLE_KEY not set", 500);
    if (!stripeKey)   return fail("STRIPE_SECRET_KEY not set", 500);
    if (!priceId)     return fail("STRIPE_PRICE_ID not set", 500);
    if (!priceId.startsWith("price_")) return fail("STRIPE_PRICE_ID must start with 'price_' not '" + priceId.slice(0,6) + "'", 500);

    // ── Auth: use service role key as apikey — this always works ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return fail("No Authorization header", 401);

    const token = authHeader.replace("Bearer ", "").trim();
    console.log("Verifying token, length:", token.length);

    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": serviceKey,   // service role key works for admin JWT verification
      },
    });
    const userData = await userRes.json();
    console.log("Auth result:", userRes.status, "id:", userData.id || "NONE", "err:", userData.message || "none");

    if (!userData.id) return fail("Auth failed: " + (userData.message || userData.error_description || "invalid token"), 401);

    const userId    = userData.id;
    const userEmail = userData.email;
    console.log("User:", userEmail);

    // ── Profile ───────────────────────────────────────────────
    const profRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=plan,stripe_customer_id`,
      { headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey } }
    );
    const profText = await profRes.text();
    console.log("Profile:", profRes.status, profText.slice(0, 150));

    let plan = null, customerId = null;
    try {
      const rows = JSON.parse(profText);
      if (Array.isArray(rows) && rows[0]) {
        plan       = rows[0].plan || null;
        customerId = rows[0].stripe_customer_id || null;
      }
    } catch(_) {}

    if (plan === "pro") return fail("Already on Pro", 400);

    // ── Stripe customer ───────────────────────────────────────
    if (!customerId) {
      const custRes = await fetch("https://api.stripe.com/v1/customers", {
        method: "POST",
        headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: `email=${encodeURIComponent(userEmail)}&metadata[supabase_user_id]=${userId}`,
      });
      const cust = await custRes.json();
      console.log("Stripe customer:", custRes.status, cust.id || cust.error?.message);
      if (!cust.id) return fail("Stripe customer error: " + (cust.error?.message || JSON.stringify(cust)), 500);
      customerId = cust.id;

      await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${serviceKey}`, "apikey": serviceKey, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ stripe_customer_id: customerId }),
      });
    }

    // ── Checkout session ──────────────────────────────────────
    console.log("Creating session, price:", priceId);
    const body = new URLSearchParams({
      "customer":                   customerId,
      "mode":                       "subscription",
      "line_items[0][price]":       priceId,
      "line_items[0][quantity]":    "1",
      "success_url":                `${appUrl}/subscription?upgraded=1`,
      "cancel_url":                 `${appUrl}/subscription?cancelled=1`,
      "metadata[supabase_user_id]": userId,
    });

    const sessRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const sess = await sessRes.json();
    console.log("Session:", sessRes.status, sess.url ? "url:ok" : "url:MISSING", sess.error?.message || "");

    if (!sess.url) return fail("Stripe session failed: " + (sess.error?.message || sess.error?.code || JSON.stringify(sess)), 500);

    return ok({ url: sess.url });

  } catch (e) {
    console.error("EXCEPTION:", e.message);
    return fail(e.message || "Internal server error", 500);
  }
});