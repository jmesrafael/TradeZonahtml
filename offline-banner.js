// ============================================================
//  offline-banner.js — Offline / Online status banner
//
//  Injects a thin banner at the top of the page showing:
//    - "You're offline — changes will sync when you reconnect"
//    - Auto-dismisses when back online
//
//  No dependencies. Load after your other scripts.
//  Call OfflineBanner.init() once on page load.
// ============================================================

const OfflineBanner = (() => {
  let _el = null;

  function init() {
    _inject();
    _update();
    window.addEventListener("online",  _onOnline);
    window.addEventListener("offline", _onOffline);
  }

  function _inject() {
    if (document.getElementById("tz-offline-banner")) return;

    const style = document.createElement("style");
    style.textContent = `
      #tz-offline-banner {
        position: fixed;
        top: 0; left: 0; right: 0;
        z-index: 99999;
        background: #f59e0b;
        color: #0b0f0c;
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 600;
        padding: 7px 16px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transform: translateY(-100%);
        transition: transform 0.25s ease;
        pointer-events: none;
      }
      #tz-offline-banner.visible {
        transform: translateY(0);
        pointer-events: all;
      }
      #tz-offline-banner .tz-ob-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #0b0f0c; opacity: 0.6; flex-shrink: 0;
        animation: tz-ob-pulse 1.4s infinite;
      }
      @keyframes tz-ob-pulse {
        0%, 100% { opacity: 0.6; }
        50%       { opacity: 0.2; }
      }
      /* Bump body down so content isn't hidden behind the banner */
      body.tz-offline {
        padding-top: 32px;
        transition: padding-top 0.25s ease;
      }
    `;
    document.head.appendChild(style);

    _el = document.createElement("div");
    _el.id = "tz-offline-banner";
    _el.innerHTML = `
      <span class="tz-ob-dot"></span>
      You're offline — changes will sync when you reconnect
    `;
    document.body.insertBefore(_el, document.body.firstChild);
  }

  function _onOnline() {
    _hide();
    // Trigger sync engine if available
    if (typeof SyncEngine !== "undefined") {
      SyncEngine.flush().catch(() => {});
    }
  }

  function _onOffline() {
    _show();
  }

  function _update() {
    navigator.onLine ? _hide() : _show();
  }

  function _show() {
    if (!_el) return;
    _el.classList.add("visible");
    document.body.classList.add("tz-offline");
  }

  function _hide() {
    if (!_el) return;
    _el.classList.remove("visible");
    document.body.classList.remove("tz-offline");
  }

  return { init };
})();

// Auto-init as soon as the DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => OfflineBanner.init());
} else {
  OfflineBanner.init();
}
