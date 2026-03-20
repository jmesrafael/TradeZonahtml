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
//
//  Each theme also gets automatic companion tokens:
//    --accent-rgb   → R,G,B values of --accent  (for rgba() usage)
//    --accent2-rgb  → R,G,B values of --accent2
//  These are computed automatically from hex values below.
// ══════════════════════════════════════════════════════════════
TZ.tokens = {
  dark: {
    '--bg':      '#0b0f0c',
    '--panel':   '#111816',
    '--panel2':  '#161d1a',
    '--accent':  '#00ff88',
    '--accent2': '#19c37d',
    '--border':  '#1c2a25',
    '--border2': '#243530',
    '--text':    '#e6f2ec',
    '--muted':   '#8fa39a',
    '--muted2':  '#5c7068',
    '--red':     '#ff5f6d',
    '--amber':   '#f59e0b',
    '--blue':    '#60a5fa',
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
  // ──────────────────────────────────────────────────────────
  'blue-electric': {
    '--bg':      '#060d18',
    '--panel':   '#0a1628',
    '--panel2':  '#0d1e35',
    '--accent':  '#00e5ff',
    '--accent2': '#0ea5e9',
    '--border':  '#0f2a45',
    '--border2': '#163860',
    '--text':    '#e0f2fe',
    '--muted':   '#7ab3d4',
    '--muted2':  '#3d6e8c',
    '--red':     '#ff4d6a',
    '--amber':   '#fbbf24',
    '--blue':    '#38bdf8',
  },
};

// ══════════════════════════════════════════════════════════════
//  2. TYPOGRAPHY
// ══════════════════════════════════════════════════════════════
TZ.fonts = {
  heading: "'Space Grotesk', sans-serif",
  body:    "'Inter', sans-serif",
};

// ══════════════════════════════════════════════════════════════
//  3. SHAPE TOKENS
// ══════════════════════════════════════════════════════════════
TZ.shape = {
  radius:  { sm:'6px', md:'8px', lg:'10px', xl:'12px', pill:'20px' },
  spacing: { xs:'4px', sm:'8px', md:'12px', lg:'18px', xl:'24px' },
};

// ══════════════════════════════════════════════════════════════
//  4. RGB HELPER
//  Converts a hex color string like "#00ff88" → "0,255,136"
//  so CSS can do: rgba(var(--accent-rgb), 0.1)
// ══════════════════════════════════════════════════════════════
TZ._hexToRgb = function(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r},${g},${b}`;
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

  // Apply all named tokens
  Object.entries(tokens).forEach(([k, v]) => root.style.setProperty(k, v));

  // Compute and inject RGB companions for opacity-based rgba() usage
  // e.g. rgba(var(--accent-rgb), 0.15) works in all browsers
  if (tokens['--accent']) {
    root.style.setProperty('--accent-rgb',  TZ._hexToRgb(tokens['--accent']));
  }
  if (tokens['--accent2']) {
    root.style.setProperty('--accent2-rgb', TZ._hexToRgb(tokens['--accent2']));
  }

  const themeClass = (pref === 'light') ? 'light' : 'dark';
  root.dataset.theme   = themeClass;
  root.dataset.variant = pref;

  TZ.currentTheme = pref;

  // Expose quick-access values for JS use
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
