// ============================================================
//  sync.js — Background Sync Engine for TradeZona
//
//  Processes sync_queue entries and pushes them to Supabase.
//  Depends on: db.js + supabase.js (loaded before this file).
//
//  Usage:
//    await SyncEngine.init(userId, journalId);   // call once after auth
//    SyncEngine.flush();                          // trigger immediate sync
//    SyncEngine.stop();                           // clean up on logout
// ============================================================

const SyncEngine = (() => {
  // ── Constants ─────────────────────────────────────────────
  const POLL_MS    = 15_000;   // background poll interval
  const MAX_TRIES  = 5;        // give up after this many failures per op
  const BUCKET     = "trade-images"; // Supabase Storage bucket name

  // ── State ─────────────────────────────────────────────────
  let _running    = false;
  let _intervalId = null;
  let _userId     = null;
  let _journalId  = null;

  // ── Public API ────────────────────────────────────────────

  async function init(userId, journalId) {
    _userId    = userId;
    _journalId = journalId;

    // Run immediately, then on a schedule
    await _runCycle();
    _intervalId = setInterval(_runCycle, POLL_MS);

    // Re-sync whenever the browser comes back online
    window.addEventListener("online", _onOnline);

    console.log("[Sync] Engine started — journal:", journalId);
  }

  function stop() {
    clearInterval(_intervalId);
    window.removeEventListener("online", _onOnline);
    _running = false;
    console.log("[Sync] Engine stopped");
  }

  /** Force an immediate sync pass (call after every local write). */
  async function flush() {
    await _runCycle();
  }

  // ── Private ───────────────────────────────────────────────

  async function _onOnline() {
    console.log("[Sync] Back online — running sync cycle");
    await _runCycle();
  }

  async function _runCycle() {
    if (_running || !navigator.onLine) return;
    _running = true;

    try {
      const pending = await localDB.sync_queue
        .where("status").equals("pending")
        .sortBy("created_at");

      if (pending.length > 0) {
        console.log(`[Sync] Processing ${pending.length} queued operations`);
      }

      for (const op of pending) {
        // Abandon ops that have failed too many times
        if (op.attempts >= MAX_TRIES) {
          await localDB.sync_queue.update(op.id, { status: "failed" });
          console.warn("[Sync] Giving up on op", op.id, op.type, op.last_error);
          continue;
        }
        await _process(op);
      }
    } catch (err) {
      console.error("[Sync] Cycle error:", err);
    } finally {
      _running = false;
    }
  }

  // ── Operation dispatcher ──────────────────────────────────

  async function _process(op) {
    try {
      switch (op.type) {

        // ── Trade ops ──────────────────────────────────────
        case "CREATE_TRADE":  await _createTrade(op);   break;
        case "UPDATE_TRADE":  await _updateTrade(op);   break;
        case "DELETE_TRADE":  await _deleteTrade(op);   break;

        // ── Image ops ──────────────────────────────────────
        case "CREATE_IMAGE":  await _createImage(op);   break;
        case "DELETE_IMAGE":  await _deleteImage(op);   break;

        // ── Settings / prefs ───────────────────────────────
        case "UPDATE_SETTINGS":     await _updateSettings(op);     break;
        case "UPDATE_PREFERENCES":  await _updatePreferences(op);  break;

        default:
          console.warn("[Sync] Unknown op type:", op.type);
      }

      // Mark done on success
      await localDB.sync_queue.update(op.id, { status: "done" });

    } catch (err) {
      console.warn(`[Sync] Op ${op.id} (${op.type}) failed:`, err.message);
      await localDB.sync_queue.update(op.id, {
        attempts:   (op.attempts || 0) + 1,
        last_error: err.message,
      });
    }
  }

  // ── Trade handlers ────────────────────────────────────────

  async function _createTrade(op) {
    const local = await localDB.trades.get(op.payload.localId);
    if (!local) return; // already deleted locally — skip

    // Idempotency check: don't re-insert if already in Supabase
    const { data: existing } = await db
      .from("trades")
      .select("id")
      .eq("id", op.payload.localId)
      .maybeSingle();

    if (!existing) {
      const row = _tradeToDb(local);
      const { error } = await db.from("trades").insert({
        ...row,
        id:         local.id,
        journal_id: local.journal_id,
        user_id:    _userId,
      });
      if (error) throw error;
    }

    await localDB.trades.update(op.payload.localId, { synced: 1 });
  }

  async function _updateTrade(op) {
    const local = await localDB.trades.get(op.payload.tradeId);
    if (!local) return;

    // Last-write-wins: only push if our local copy is newer
    const { data: remote } = await db
      .from("trades")
      .select("updated_at")
      .eq("id", op.payload.tradeId)
      .maybeSingle();

    const remoteTs = remote?.updated_at ? new Date(remote.updated_at).getTime() : 0;

    if (local.updated_at >= remoteTs) {
      const { error } = await db
        .from("trades")
        .update(_tradeToDb(local))
        .eq("id", op.payload.tradeId);
      if (error) throw error;
    }

    await localDB.trades.update(op.payload.tradeId, { synced: 1 });
  }

  async function _deleteTrade(op) {
    const { error } = await db
      .from("trades")
      .delete()
      .eq("id", op.payload.tradeId);

    // Treat "row not found" as success (already deleted remotely)
    if (error && !_isNotFound(error)) throw error;
  }

  // ── Image handlers ────────────────────────────────────────

  async function _createImage(op) {
    const img = await localDB.images.get(op.payload.localImageId);
    if (!img) return;

    // Make sure the parent trade is already in Supabase first
    const parentTrade = await localDB.trades.get(img.trade_id).catch(() => null);
    if (parentTrade && parentTrade.synced === 0) {
      // Defer — parent not yet pushed; bump attempt count and try next cycle
      await localDB.sync_queue.update(op.id, { attempts: (op.attempts || 0) + 1 });
      return;
    }

    // ── Upload to Supabase Storage bucket ─────────────────
    const ext      = _guessExtension(img.preview || "");
    const filePath = `${_userId}/${img.trade_id}/${img.id}.${ext}`;
    const blob     = await _dataUrlToBlob(img.preview || img.url || "");

    if (!blob) throw new Error("No image data available for upload");

    const { error: upErr } = await db.storage
      .from(BUCKET)
      .upload(filePath, blob, { upsert: true });

    if (upErr) throw upErr;

    // Get the public URL
    const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(filePath);
    const publicUrl = urlData?.publicUrl || "";

    // ── Insert row into trade_images table ─────────────────
    const { data: row, error: insErr } = await db
      .from("trade_images")
      .insert({
        trade_id: img.trade_id,
        user_id:  _userId,
        url:      publicUrl,
        // Keep data column null — we use Storage now, not base64
        data:     null,
      })
      .select()
      .single();

    if (insErr) throw insErr;

    // Update local record: clear preview, store real URL + Supabase id
    await localDB.images.update(op.payload.localImageId, {
      id:      row.id,      // replace local UUID with real Supabase id
      url:     publicUrl,
      preview: "",          // discard the heavy base64/blob — URL is enough now
      synced:  1,
    });
  }

  async function _deleteImage(op) {
    // Delete the database row
    const { error: rowErr } = await db
      .from("trade_images")
      .delete()
      .eq("id", op.payload.imageId);

    if (rowErr && !_isNotFound(rowErr)) throw rowErr;

    // Best-effort remove from Storage (non-fatal if it fails)
    if (op.payload.storagePath) {
      await db.storage.from(BUCKET).remove([op.payload.storagePath]).catch(() => {});
    }
  }

  // ── Settings / preferences handlers ──────────────────────

  async function _updateSettings(op) {
    const { error } = await db
      .from("journal_settings")
      .update(op.payload.updates)
      .eq("journal_id", op.payload.journalId);
    if (error) throw error;
  }

  async function _updatePreferences(op) {
    // Prefs live in the profiles table (theme, font, etc.)
    const { error } = await db
      .from("profiles")
      .update(op.payload.updates)
      .eq("id", op.payload.userId);
    if (error) throw error;
  }

  // ── DB mapping (mirrors tradeToDb in supabase.js) ─────────

  function _tradeToDb(t) {
    const o = {};
    if ("date"       in t) o.trade_date  = t.date  || null;
    if ("time"       in t) o.trade_time  = t.time  || null;
    if ("pair"       in t) o.pair        = t.pair  || null;
    if ("position"   in t) o.position    = t.position || null;
    if ("strategy"   in t) o.strategy    = t.strategy  || [];
    if ("timeframe"  in t) o.timeframe   = t.timeframe || [];
    if ("pnl"        in t) { const n = parseFloat(t.pnl); o.pnl      = !isNaN(n) && t.pnl != null && t.pnl !== "" ? n : null; }
    if ("r"          in t) { const n = parseFloat(t.r);   o.r_factor = !isNaN(n) && t.r  != null && t.r  !== "" ? n : null; }
    if ("confidence" in t) o.confidence  = t.confidence || null;
    if ("mood"       in t) o.mood        = t.mood  || [];
    if ("notes"      in t) o.notes       = t.notes || null;
    if ("updated_at" in t && t.updated_at) {
      o.updated_at = new Date(t.updated_at).toISOString();
    }
    return o;
  }

  // ── Utilities ─────────────────────────────────────────────

  function _isNotFound(error) {
    return (
      error?.code === "PGRST116" ||
      error?.message?.includes("0 rows") ||
      error?.message?.includes("not found")
    );
  }

  function _guessExtension(dataUrl) {
    if (!dataUrl) return "jpg";
    if (dataUrl.includes("image/png"))  return "png";
    if (dataUrl.includes("image/gif"))  return "gif";
    if (dataUrl.includes("image/webp")) return "webp";
    return "jpg";
  }

  async function _dataUrlToBlob(dataUrl) {
    if (!dataUrl) return null;
    // Already a proper base64 data-url
    if (dataUrl.startsWith("data:")) {
      const res  = await fetch(dataUrl);
      return res.blob();
    }
    // Remote URL — fetch the blob
    if (dataUrl.startsWith("http")) {
      const res = await fetch(dataUrl);
      return res.blob();
    }
    return null;
  }

  return { init, stop, flush };
})();
