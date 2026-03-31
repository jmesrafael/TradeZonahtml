// ============================================================
//  supabase.js — TradeZona Supabase client (local-first)
//
//  LOAD ORDER:
//    1. supabase-js CDN
//    2. dexie.min.js CDN
//    3. db.js           (IndexedDB schema + genId + enqueue)
//    4. supabase.js     ← this file
//    5. sync.js         (background sync engine)
//    6. offline-banner.js
// ============================================================

const SUPABASE_URL  = "https://oixrpuqylidbunbttftg.supabase.co";
const SUPABASE_ANON = "sb_publishable_0JIYopUpUp6DonOkOzWcJQ_KL0OyIho";
const IMG_BUCKET    = "trade-images"; // Supabase Storage bucket

const { createClient } = supabase;

const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage:           window.localStorage,
    autoRefreshToken:  true,
    persistSession:    true,
    detectSessionInUrl: true,
  },
});

// ── Auth state watcher ────────────────────────────────────
db.auth.onAuthStateChange(async (event, session) => {
  const publicPaths = ["/", "/auth", "/confirm", "/reset-password"];
  const path = window.location.pathname
    .replace(/\.html$/, "").replace(/\/$/, "") || "/";

  if (event === "SIGNED_OUT") {
    if (!publicPaths.includes(path)) window.location.href = "/auth";
  }

  if (event === "PASSWORD_RECOVERY") {
    if (!path.includes("reset-password")) window.location.href = "/reset-password";
  }

  // Apply locally-cached preferences immediately on any page load
  if (event === "SIGNED_IN" && session?.user) {
    try {
      await _applyLocalPreferences(session.user.id);
    } catch (_) {}

    // Referral logic
    try {
      const refCode = localStorage.getItem("ref_code");
      if (refCode) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/apply-referral`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ referral_code: refCode }),
        });
        await res.json();
        localStorage.removeItem("ref_code");
      }
    } catch (err) {
      console.error("Referral error:", err);
    }
  }
});

// ── requireAuth ───────────────────────────────────────────
async function requireAuth() {
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) {
    await db.auth.signOut();
    window.location.href = "/auth";
    return null;
  }
  return user;
}

async function getUser() {
  const { data: { user } } = await db.auth.getUser();
  return user;
}

// ── Profile ───────────────────────────────────────────────
// Profile reads always go to Supabase (low frequency, authoritative).
async function getProfile(userId) {
  const { data } = await db.from("profiles").select("*").eq("id", userId).single();
  return data;
}

// ═══════════════════════════════════════════════════════════
//  USER PREFERENCES — local-first, cross-device sync
// ═══════════════════════════════════════════════════════════

/**
 * Get preferences for a user.
 * Returns local cache instantly; refreshes from Supabase in background.
 */
async function getPreferences(userId) {
  const cached = await localDB.preferences.get(userId).catch(() => null);

  // Background refresh — don't await
  _refreshPreferencesFromCloud(userId).catch(() => {});

  if (cached) return cached;

  // First run — fetch from Supabase
  const { data } = await db.from("profiles")
    .select("theme, font, preferences")
    .eq("id", userId).single();

  const prefs = { user_id: userId, ...(data || {}) };
  await localDB.preferences.put(prefs).catch(() => {});
  return prefs;
}

/**
 * Save preference changes.
 * Applies locally first, then queues a push to Supabase.
 */
async function savePreferences(userId, updates) {
  const existing = await localDB.preferences.get(userId).catch(() => null);
  const merged   = { user_id: userId, ...(existing || {}), ...updates };

  await localDB.preferences.put(merged);

  // Also persist theme/font to localStorage for immediate cross-tab use
  if (updates.theme) localStorage.setItem("tl_theme", updates.theme);
  if (updates.font)  localStorage.setItem("tl_font",  updates.font);

  await enqueue("UPDATE_PREFERENCES", { userId, updates });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }
}

// ── Journals ──────────────────────────────────────────────
// Journals are low-frequency writes that need authoritative data
// on the dashboard — they stay online-only.

async function getJournals(userId) {
  const { data, error } = await db
    .from("journals").select("*").eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) { console.error("getJournals:", error); return []; }
  return data || [];
}

async function createJournal(userId, { name, capital, pin_hash, show_pnl = true, show_capital = true }) {
  const { data, error } = await db.from("journals")
    .insert({ user_id: userId, name, capital: capital || null,
              pin_hash: pin_hash || null, show_pnl, show_capital })
    .select().single();
  if (error) throw error;

  await db.from("journal_settings").insert({
    journal_id: data.id, user_id: userId,
    strategies: ["Breakout", "Reversal", "Trend"],
    timeframes:  ["M15", "H1", "H4"],
    pairs:       ["EURUSD", "XAUUSD", "BTCUSDT"],
    moods:       ["Confident", "Neutral", "Anxious"],
    mood_colors: { Confident: "#19c37d", Neutral: "#8fa39a", Anxious: "#f59e0b" },
  });
  return data;
}

async function updateJournal(journalId, updates) {
  const { error } = await db.from("journals").update(updates).eq("id", journalId);
  if (error) throw error;
}

async function deleteJournal(journalId) {
  // Wipe local IndexedDB data for this journal first
  try {
    await localDB.trades.where("journal_id").equals(journalId).delete();
    await localDB.settings.where("journal_id").equals(journalId).delete();
  } catch (e) {
    console.warn("[Local] Could not clean up local data for journal:", e);
  }
  const { error } = await db.from("journals").delete().eq("id", journalId);
  if (error) throw error;
}

// ═══════════════════════════════════════════════════════════
//  TRADES — LOCAL-FIRST
// ═══════════════════════════════════════════════════════════

/**
 * getTrades — instant from IndexedDB, background refresh from Supabase.
 *
 * Returns rows already in the shape dbToTrade() expects
 * (same as what Supabase would return: trade_date, r_factor, trade_images, …)
 */
async function getTrades(journalId) {
  // 1. Read local immediately
  let local = await localDB.trades
    .where("journal_id").equals(journalId)
    .toArray();

  // 2. Attach images for each trade
  for (const t of local) {
    if (!t._imagesLoaded) {
      const imgs = await localDB.images.where("trade_id").equals(t.id).toArray();
      t.images = imgs;
      t._imagesLoaded = true;
    }
  }

  // 3. Background refresh from Supabase (do not await)
  _refreshTradesFromCloud(journalId).catch(e =>
    console.warn("[Sync] Background refresh failed:", e.message)
  );

  // 4. Return in the Supabase row shape so dbToTrade() keeps working
  return _localTradesToDbShape(local);
}

/**
 * createTrade — writes locally first, then queues Supabase insert.
 */
async function createTrade(userId, journalId, trade) {
  const id  = genId();
  const now = Date.now();

  const localRow = {
    id,
    journal_id:    journalId,
    user_id:       userId,
    synced:        0,
    updated_at:    now,
    created_at:    now,
    _imagesLoaded: true,
    // UI fields
    date:       trade.date       || "",
    time:       trade.time       || "",
    pair:       trade.pair       || "",
    position:   trade.position   || "Long",
    strategy:   trade.strategy   || [],
    timeframe:  trade.timeframe  || [],
    pnl:        trade.pnl != null && trade.pnl !== "" ? trade.pnl : "",
    r:          trade.r   != null && trade.r   !== "" ? trade.r   : "",
    confidence: trade.confidence || 0,
    mood:       trade.mood       || [],
    notes:      trade.notes      || "",
    images:     [],
  };

  await localDB.trades.add(localRow);
  await enqueue("CREATE_TRADE", { localId: id });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }

  return { id, ...localRow };
}

/**
 * updateTrade — merges changes into IndexedDB, queues Supabase update.
 */
async function updateTrade(tradeId, updates) {
  const now      = Date.now();
  const existing = await localDB.trades.get(tradeId);

  if (!existing) {
    // Edge case: not cached locally — fall through to Supabase directly
    const payload = tradeToDb(updates);
    if (!Object.keys(payload).length) return;
    const { error } = await db.from("trades").update(payload).eq("id", tradeId);
    if (error) throw error;
    return;
  }

  await localDB.trades.update(tradeId, {
    ..._uiToLocal(updates),
    synced:     0,
    updated_at: now,
  });

  await enqueue("UPDATE_TRADE", { tradeId });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }
}

/**
 * deleteTrade — removes from IndexedDB immediately, queues Supabase delete.
 */
async function deleteTrade(tradeId) {
  await localDB.images.where("trade_id").equals(tradeId).delete();
  await localDB.trades.delete(tradeId);
  await enqueue("DELETE_TRADE", { tradeId });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }
}

// ── DB ↔ UI mapping ───────────────────────────────────────
// Kept identical to the originals so existing callers don't break.

function tradeToDb(t) {
  const o = {};
  if ("date"       in t) o.trade_date  = t.date  || null;
  if ("time"       in t) o.trade_time  = t.time  || null;
  if ("pair"       in t) o.pair        = t.pair  || null;
  if ("position"   in t) o.position    = t.position || null;
  if ("strategy"   in t) o.strategy    = t.strategy  || [];
  if ("timeframe"  in t) o.timeframe   = t.timeframe || [];
  if ("pnl"  in t) { const n = parseFloat(t.pnl); o.pnl      = !isNaN(n) && t.pnl != null && t.pnl !== "" ? n : null; }
  if ("r"    in t) { const n = parseFloat(t.r);   o.r_factor = !isNaN(n) && t.r   != null && t.r   !== "" ? n : null; }
  if ("confidence" in t) o.confidence  = t.confidence || null;
  if ("mood"       in t) o.mood        = t.mood  || [];
  if ("notes"      in t) o.notes       = t.notes || null;
  return o;
}

function dbToTrade(row) {
  return {
    id:         row.id,
    date:       row.trade_date || row.date || "",
    time:       row.trade_time
                  ? String(row.trade_time).slice(0, 5)
                  : row.time ? String(row.time).slice(0, 5) : "",
    pair:       row.pair || "",
    position:   row.position || "Long",
    strategy:   row.strategy  || [],
    timeframe:  row.timeframe || [],
    pnl:        row.pnl      != null ? String(row.pnl)      : "",
    r:          row.r_factor != null ? String(row.r_factor)
                  : row.r   != null  ? String(row.r)        : "",
    confidence: row.confidence || 0,
    mood:       row.mood  || [],
    notes:      row.notes || "",
    images: (row.trade_images || row.images || []).map(img => ({
      id:      img.id,
      data:    img.data    || "",      // legacy base64 support
      url:     img.url     || "",      // Storage URL (preferred)
      preview: img.preview || "",      // local pending preview
    })),
  };
}

// ═══════════════════════════════════════════════════════════
//  TRADE IMAGES — local-first, uploads to Supabase Storage
// ═══════════════════════════════════════════════════════════

/**
 * addTradeImage — saves image locally with a preview, queues bucket upload.
 * Returns immediately with a local record so the UI can render right away.
 */
async function addTradeImage(userId, tradeId, base64DataUrl) {
  const localId = genId();

  await localDB.images.add({
    id:       localId,
    trade_id: tradeId,
    user_id:  userId,
    url:      "",              // filled in by sync engine after upload
    preview:  base64DataUrl,   // displayed while pending
    synced:   0,
  });

  await enqueue("CREATE_IMAGE", { localImageId: localId });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }

  return {
    id:          localId,
    data:        base64DataUrl,    // legacy compat
    url:         "",
    preview:     base64DataUrl,
    _previewUrl: base64DataUrl,    // used by notes modal
  };
}

/**
 * getImageUrl — returns the best available URL for an image.
 * Priority: Storage URL > preview/base64 > local DB > empty
 */
async function getImageUrl(img) {
  if (!img) return "";
  if (img.url)     return img.url;        // Supabase Storage URL
  if (img.preview) return img.preview;    // pending local preview
  if (img.data)    return img.data;       // legacy base64
  if (img._previewUrl) return img._previewUrl;

  // Try local DB
  const local = await localDB.images.get(img.id).catch(() => null);
  if (local?.url)     return local.url;
  if (local?.preview) return local.preview;
  if (local?.data)    return local.data || "";

  return "";
}

/**
 * deleteTradeImage — removes locally and queues Supabase deletion.
 */
async function deleteTradeImage(imageId) {
  // Grab the storage path before deleting
  const local = await localDB.images.get(imageId).catch(() => null);
  await localDB.images.delete(imageId);

  // Build storage path for cleanup (best-effort)
  let storagePath = null;
  if (local?.url) {
    // Extract relative path from the public URL
    const marker = `/${IMG_BUCKET}/`;
    const idx    = local.url.indexOf(marker);
    if (idx !== -1) storagePath = local.url.slice(idx + marker.length);
  }

  await enqueue("DELETE_IMAGE", { imageId, storagePath });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════
//  JOURNAL SETTINGS — local-first
// ═══════════════════════════════════════════════════════════

async function getJournalSettings(journalId) {
  const cached = await localDB.settings.get(journalId).catch(() => null);
  if (cached) {
    // Refresh from cloud in background
    _refreshSettingsFromCloud(journalId).catch(() => {});
    return cached;
  }

  // Not cached — fetch from Supabase and store
  const { data } = await db
    .from("journal_settings").select("*")
    .eq("journal_id", journalId).single();

  if (data) await localDB.settings.put({ ...data, journal_id: journalId });
  return data;
}

async function updateJournalSettings(journalId, updates) {
  // Merge into local cache immediately
  const existing = await localDB.settings.get(journalId).catch(() => null);
  if (existing) {
    await localDB.settings.update(journalId, updates);
  }

  await enqueue("UPDATE_SETTINGS", { journalId, updates });

  if (navigator.onLine && typeof SyncEngine !== "undefined") {
    SyncEngine.flush().catch(() => {});
  }
}

// ── Realtime ──────────────────────────────────────────────

function subscribeTrades(journalId, callback) {
  return db
    .channel("trades:" + journalId)
    .on("postgres_changes", {
      event:  "*",
      schema: "public",
      table:  "trades",
      filter: `journal_id=eq.${journalId}`,
    }, async (payload) => {
      // Merge incoming Supabase change into local DB
      if (payload.eventType === "DELETE") {
        await localDB.trades.delete(payload.old?.id).catch(() => {});
      } else if (payload.new?.id) {
        const existing  = await localDB.trades.get(payload.new.id).catch(() => null);
        const remoteTs  = new Date(payload.new.updated_at || 0).getTime();
        if (!existing || existing.updated_at <= remoteTs) {
          await localDB.trades.put(_cloudRowToLocal(payload.new));
        }
      }
      callback(payload);
    })
    .subscribe();
}

// ── PIN security ──────────────────────────────────────────

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPin(pin, hash) {
  if (!hash) return true;
  return (await hashPin(pin)) === hash;
}

// ═══════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════

/** Pull all trades for the journal from Supabase and merge locally (last-write-wins). */
async function _refreshTradesFromCloud(journalId) {
  if (!navigator.onLine) return;

  const { data, error } = await db
    .from("trades")
    .select("*, trade_images(id, data, url)")
    .eq("journal_id", journalId)
    .order("created_at", { ascending: false });

  if (error || !data) return;

  for (const row of data) {
    const remoteTs = new Date(row.updated_at || 0).getTime();
    const local    = await localDB.trades.get(row.id).catch(() => null);

    if (!local || local.updated_at <= remoteTs) {
      await localDB.trades.put(_cloudRowToLocal(row));

      // Sync images
      for (const img of (row.trade_images || [])) {
        const exists = await localDB.images.get(img.id).catch(() => null);
        if (!exists) {
          await localDB.images.put({
            id:       img.id,
            trade_id: row.id,
            url:      img.url  || "",
            data:     img.data || "",   // legacy base64 compat
            preview:  "",
            synced:   1,
          });
        }
      }
    }
  }
}

/** Pull settings from Supabase and update local cache. */
async function _refreshSettingsFromCloud(journalId) {
  if (!navigator.onLine) return;
  const { data } = await db
    .from("journal_settings").select("*")
    .eq("journal_id", journalId).single();
  if (data) await localDB.settings.put({ ...data, journal_id: journalId });
}

/** Pull preferences from Supabase and update local cache. */
async function _refreshPreferencesFromCloud(userId) {
  if (!navigator.onLine) return;
  const { data } = await db.from("profiles")
    .select("theme, font, preferences").eq("id", userId).single();
  if (data) {
    const merged = { user_id: userId, ...data };
    await localDB.preferences.put(merged);
  }
}

/** On SIGNED_IN: apply locally cached theme/font immediately (before cloud fetch). */
async function _applyLocalPreferences(userId) {
  const cached = await localDB.preferences.get(userId).catch(() => null);
  if (!cached) return;
  if (cached.theme) localStorage.setItem("tl_theme", cached.theme);
  if (cached.font)  localStorage.setItem("tl_font",  cached.font);
  // Let theme.js pick it up — or dispatch event if theme.js listens
  window.dispatchEvent(new CustomEvent("tz_prefs_ready", { detail: cached }));
}

/**
 * Convert a Supabase cloud row to the local IndexedDB trade shape.
 */
function _cloudRowToLocal(row) {
  return {
    id:            row.id,
    journal_id:    row.journal_id,
    user_id:       row.user_id,
    synced:        1,
    updated_at:    row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
    created_at:    row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    _imagesLoaded: false,
    // UI-friendly field names
    date:       row.trade_date || "",
    time:       row.trade_time ? String(row.trade_time).slice(0, 5) : "",
    pair:       row.pair       || "",
    position:   row.position   || "Long",
    strategy:   row.strategy   || [],
    timeframe:  row.timeframe  || [],
    pnl:        row.pnl      != null ? String(row.pnl)      : "",
    r:          row.r_factor != null ? String(row.r_factor) : "",
    confidence: row.confidence || 0,
    mood:       row.mood  || [],
    notes:      row.notes || "",
    images:     [],
  };
}

/**
 * Convert local IndexedDB rows to the shape Supabase rows use,
 * so dbToTrade() in logs.html continues to work without changes.
 */
function _localTradesToDbShape(locals) {
  return locals.map(t => ({
    id:           t.id,
    journal_id:   t.journal_id,
    trade_date:   t.date  || null,
    trade_time:   t.time  || null,
    pair:         t.pair  || null,
    position:     t.position || null,
    strategy:     t.strategy  || [],
    timeframe:    t.timeframe || [],
    pnl:          t.pnl !== "" && t.pnl != null ? parseFloat(t.pnl) : null,
    r_factor:     t.r   !== "" && t.r   != null ? parseFloat(t.r)   : null,
    confidence:   t.confidence || null,
    mood:         t.mood  || [],
    notes:        t.notes || null,
    updated_at:   t.updated_at ? new Date(t.updated_at).toISOString() : null,
    created_at:   t.created_at ? new Date(t.created_at).toISOString() : null,
    // Images: show preview while pending, url once synced
    trade_images: (t.images || []).map(i => ({
      id:      i.id,
      data:    i.data    || i.preview || "",   // legacy compat + offline preview
      url:     i.url     || "",
      preview: i.preview || "",
    })),
  }));
}

/**
 * Map UI field names to local DB field names.
 * The local trade row uses the same names as the UI (date, time, pnl, r…)
 * — no remapping needed — but images need special handling.
 */
function _uiToLocal(updates) {
  const o = {};
  const fields = ["pair", "position", "strategy", "timeframe", "pnl", "r",
                  "confidence", "mood", "notes", "date", "time"];
  for (const k of fields) {
    if (k in updates) o[k] = updates[k];
  }
  // Don't overwrite the full images array from an update payload
  return o;
}
