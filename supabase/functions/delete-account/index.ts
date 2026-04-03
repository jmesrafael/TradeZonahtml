// supabase/functions/delete-account/index.ts
// Deploy with: supabase functions deploy delete-account --no-verify-jwt

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), { status: 401, headers: CORS });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── 1. Verify the user token and get their ID ──────────────────────────
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "apikey": serviceKey,
      },
    });
    const userData = await userRes.json();

    if (!userData?.id) {
      console.error("Auth failed:", JSON.stringify(userData));
      return new Response(JSON.stringify({ error: "Invalid or expired session. Please sign in again." }), {
        status: 401, headers: CORS,
      });
    }

    const userId = userData.id;
    console.log("Deleting account for user:", userId);

    // ── 2. Helper: DELETE rows from a table by a given column ──────────────
    const deleteRows = async (table: string, col: string) => {
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${col}=eq.${userId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey,
          "Prefer": "return=minimal",
        },
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`Failed to delete from ${table} (${col}):`, err);
      } else {
        console.log(`Deleted from ${table} (${col})`);
      }
    };

    // ── 3. Delete data in dependency order ────────────────────────────────
    // trade_images first (depends on trades)
    await deleteRows("trade_images", "user_id");

    // trades (depends on journals)
    await deleteRows("trades", "user_id");

    // journal_settings (depends on journals)
    await deleteRows("journal_settings", "user_id");

    // journals
    await deleteRows("journals", "user_id");

    // referrals — user can appear in EITHER column, delete both
    await deleteRows("referrals", "referrer_id");
    await deleteRows("referrals", "referred_user_id");

    // profile (keyed on id, not user_id)
    await deleteRows("profiles", "id");

    // ── 4. Delete the auth user last ───────────────────────────────────────
    const deleteAuthRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey,
      },
    });

    if (!deleteAuthRes.ok) {
      const err = await deleteAuthRes.json().catch(() => ({ message: deleteAuthRes.statusText }));
      console.error("Auth user deletion failed:", JSON.stringify(err));
      return new Response(
        JSON.stringify({ error: "Failed to delete auth user: " + (err.message || deleteAuthRes.statusText) }),
        { status: 500, headers: CORS }
      );
    }

    console.log("Account successfully deleted for user:", userId);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: CORS });

  } catch (err: any) {
    console.error("FATAL:", err.message);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: CORS,
    });
  }
});