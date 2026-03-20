/**
 * theme.js — TradeZona Design System
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for ALL visual design across the app.
 * Include in every page: <script src="theme.js"></script>
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  TO CHANGE THE ENTIRE APP APPEARANCE:                   │
 * │  Edit TZ.tokens.dark / TZ.tokens.light below.           │
 * │  Everything — colors, fonts, radius, spacing — is here. │
 * └─────────────────────────────────────────────────────────┘
 */

window.TZ = window.TZ || {};

// ══════════════════════════════════════════════════════════════
//  1. COLOR TOKENS  — edit here to retheme the whole app
// ══════════════════════════════════════════════════════════════
TZ.tokens = {
  dark: {
    '--bg':      '#0b0f0c',   // page background
    '--panel':   '#111816',   // card / panel background
    '--panel2':  '#161d1a',   // secondary panel (modals, strips)
    '--accent':  '#00ff88',   // primary green — buttons, highlights
    '--accent2': '#19c37d',   // secondary green — icons, borders
    '--border':  '#1c2a25',   // default border
    '--border2': '#243530',   // slightly stronger border
    '--text':    '#e6f2ec',   // primary text
    '--muted':   '#8fa39a',   // secondary / placeholder text
    '--muted2':  '#5c7068',   // tertiary / disabled text
    '--red':     '#ff5f6d',   // error / loss / danger
    '--amber':   '#f59e0b',   // warning / unsaved
    '--blue':    '#60a5fa',   // info
  },
  light: {
    '--bg':      '#eef3f0',
    '--panel':   '#ffffff',
    '--panel2':  '#e8f0ec',
    '--accent':  '#19c37d',
    '--accent2': '#0a9460',
    '--border':  '#c4d4cc',
    '--border2': '#b5c8bf',
    '--text':    '#0a1812',
    '--muted':   '#2e5044',
    '--muted2':  '#4a7065',
    '--red':     '#dc2626',
    '--amber':   '#b45309',
    '--blue':    '#1d4ed8',
  },

  // ──────────────────────────────────────────────────────────
  //  BLUE ELECTRIC — deep navy base, neon cyan accent
  //  A techy, high-contrast dark theme with electric energy.
  //  Inspired by terminal grids, radar screens, and circuit boards.
  // ──────────────────────────────────────────────────────────
  'blue-electric': {
    '--bg':      '#060d18',   // deep navy-black page background
    '--panel':   '#0a1628',   // dark navy card / panel background
    '--panel2':  '#0d1e35',   // secondary panel (modals, strips)
    '--accent':  '#00e5ff',   // neon cyan — primary buttons, highlights
    '--accent2': '#0ea5e9',   // electric blue — icons, secondary borders
    '--border':  '#0f2a45',   // subtle navy border
    '--border2': '#163860',   // stronger blue border
    '--text':    '#e0f2fe',   // icy blue-white primary text
    '--muted':   '#7ab3d4',   // muted sky blue secondary text
    '--muted2':  '#3d6e8c',   // dimmed tertiary / disabled text
    '--red':     '#ff4d6a',   // hot red — loss / danger
    '--amber':   '#fbbf24',   // amber — warning / unsaved
    '--blue':    '#38bdf8',   // lighter sky blue — info
  },
};

// ══════════════════════════════════════════════════════════════
//  2. TYPOGRAPHY  — fonts used across the app
// ══════════════════════════════════════════════════════════════
TZ.fonts = {
  heading: "'Space Grotesk', sans-serif",  // headings, labels, numbers
  body:    "'Inter', sans-serif",           // body text, inputs
};

// ══════════════════════════════════════════════════════════════
//  3. SHAPE TOKENS  — border radius & spacing scale
// ══════════════════════════════════════════════════════════════
TZ.shape = {
  radius: { sm:'6px', md:'8px', lg:'10px', xl:'12px', pill:'20px' },
  spacing:{ xs:'4px', sm:'8px', md:'12px', lg:'18px', xl:'24px' },
};

// ══════════════════════════════════════════════════════════════
//  5. THEME ENGINE
// ══════════════════════════════════════════════════════════════

TZ._resolveTokens = function(mode) {
  if (mode === 'system') {
    const prefersDark = !window.matchMedia('(prefers-color-scheme:light)').matches;
    return prefersDark ? TZ.tokens.dark : TZ.tokens.light;
  }
  return TZ.tokens[mode] || TZ.tokens.dark;
};

TZ.applyTheme = function(mode) {
  const pref   = mode || localStorage.getItem('tl_theme') || 'dark';
  const tokens = TZ._resolveTokens(pref);
  const root   = document.documentElement;

  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));

  const themeClass = (pref === 'light') ? 'light' : 'dark';
  root.dataset.theme   = themeClass;
  root.dataset.variant = pref;

  TZ.currentTheme = pref;

  TZ.accent  = tokens['--accent'];
  TZ.accent2 = tokens['--accent2'];
  TZ.muted   = tokens['--muted'];
  TZ.border  = tokens['--border'];
  TZ.text    = tokens['--text'];
  TZ.red     = tokens['--red'];
};

TZ.setTheme = function(mode) {
  localStorage.setItem('tl_theme', mode);
  TZ.applyTheme(mode);
  document.querySelectorAll('iframe').forEach(f => {
    try { f.contentWindow.postMessage({ type:'tz_theme', theme:mode }, '*'); } catch(e) {}
  });
};

// ── Listen for theme messages from parent ──────────────────────
window.addEventListener('message', function(e) {
  if (e.data?.type === 'tz_theme')     TZ.applyTheme(e.data.theme);
  if (e.data?.theme && !e.data?.type)  TZ.applyTheme(e.data.theme);
});

// ── Backward-compat alias ──────────────────────────────────────
window.applyTheme = TZ.applyTheme;

// ── Auto-apply on load ─────────────────────────────────────────
TZ.applyTheme();

// ══════════════════════════════════════════════════════════════
//  6. PAGE LOADER
//     Pages include <div id="pageLoader"></div> in their HTML.
//     Call TZ.hideLoader() when the page is ready.
// ══════════════════════════════════════════════════════════════
(function() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes tz-spin { to { transform: rotate(360deg); } }
    #pageLoader {
      position: fixed; inset: 0;
      background: var(--bg);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 18px; z-index: 9999;
      transition: opacity .35s ease;
    }
    #pageLoader.gone { opacity: 0; pointer-events: none; }
    #pageLoader .tz-pl-logo {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 22px; font-weight: 700; letter-spacing: .3px;
      color: var(--text);
    }
    #pageLoader .tz-pl-logo span { color: var(--accent); }
    #pageLoader .tz-pl-spin {
      width: 28px; height: 28px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: tz-spin .7s linear infinite;
    }
  `;
  document.head.appendChild(s);
})();

TZ.buildLoader = function() {
  const el = document.getElementById('pageLoader');
  if (!el || el.children.length) return;
  el.innerHTML = `
    <div class="tz-pl-logo">Trade<span>Zona</span></div>
    <div class="tz-pl-spin"></div>
  `;
};

TZ.hideLoader = function() {
  const el = document.getElementById('pageLoader');
  if (!el) return;
  el.classList.add('gone');
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', TZ.buildLoader);
} else {
  TZ.buildLoader();
}