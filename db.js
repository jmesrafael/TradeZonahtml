// ============================================================
//  db.js — IndexedDB schema for TradeZona (Dexie v3)
//
//  LOAD ORDER on every protected page:
//    1. supabase-js      (CDN)
//    2. dexie.min.js     (CDN)
//    3. db.js            ← this file
//    4. supabase.js
//    5. sync.js
//    6. offline-banner.js
// ============================================================

const localDB = new Dexie("TradeZonaDB");

localDB.version(1).stores({
  // ── Trades ────────────────────────────────────────────────
  // id         = UUID (local temp or Supabase real id)
  // journal_id = which journal this belongs to
  // synced     = 0 (pending push) | 1 (confirmed in Supabase)
  // updated_at = Unix ms — used for last-write-wins conflict res
  trades: "id, journal_id, synced, updated_at",

  // ── Images ────────────────────────────────────────────────
  // Images are uploaded to Supabase Storage (bucket: trade-images).
  // We store the returned PUBLIC URL here — NOT raw base64.
  //
  // While a new image is pending upload we keep a temporary
  // preview (base64 / object-url) so the UI can render it
  // immediately. Once the upload succeeds:
  //   - url     = Supabase Storage public URL
  //   - preview = cleared (set to "")
  //   - synced  = 1
  //
  // id       = local UUID until synced, then Supabase row id
  // trade_id = parent trade id (may be a local temp id)
  // url      = public bucket URL (empty while pending)
  // preview  = temporary local blob / base64 (display only)
  // synced   = 0 | 1
  images: "id, trade_id, synced",

  // ── Sync Queue ────────────────────────────────────────────
  // Every mutation (create/update/delete trade or image,
  // settings update) creates one entry here.
  // The sync engine processes entries in created_at order.
  //
  // type: "CREATE_TRADE" | "UPDATE_TRADE" | "DELETE_TRADE"
  //       "CREATE_IMAGE" | "DELETE_IMAGE"
  //       "UPDATE_SETTINGS" | "UPDATE_PREFERENCES"
  sync_queue: "++id, status, type, created_at",

  // ── Journal Settings ──────────────────────────────────────
  // Cached copy of the journal_settings Supabase row.
  // Keyed by journal_id.
  settings: "journal_id",

  // ── User Preferences ──────────────────────────────────────
  // Theme, font, and any other per-user display prefs.
  // Keyed by user_id so multiple accounts work on one browser.
  // Synced to the Supabase profiles table for cross-device use.
  preferences: "user_id",
});

// ── Helpers ──────────────────────────────────────────────────

/**
 * Generate a UUID v4 without any external library dependency.
 */
function genId() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

/**
 * Enqueue a sync operation.
 * Called by every write path in supabase.js before returning.
 *
 * @param {string} type    — operation type constant (see sync_queue schema above)
 * @param {object} payload — data the sync engine needs to execute this op
 */
async function enqueue(type, payload) {
  await localDB.sync_queue.add({
    type,
    payload,
    status:     "pending",   // updated to "done" or "failed" by sync engine
    created_at: Date.now(),
    attempts:   0,
    last_error: null,
  });
}
