// ═══════════════════════════════════════════════════════════════════
//  presession.js — Full Pre-Session system with Supabase integration
// ═══════════════════════════════════════════════════════════════════

window.addEventListener('message', e => {
  if (e.data?.type === 'tz_plan' && e.data.isPro !== undefined) userIsPro = e.data.isPro;
  if (e.data?.type === 'tz_settings_updated') reloadJournalSettings();
  if (e.data?.type === 'tz_theme') {} // theme.js handles this
  if (e.data?.type === 'tz_font')  {} // theme.js handles this
});

// ── Journal ID (same pattern as logs.js) ────────────────────────────
const jid = sessionStorage.getItem('tz_current_journal')
  || localStorage.getItem('tz_current_journal')
  || (()=>{ try { return parent?.sessionStorage?.getItem('tz_current_journal') || parent?.localStorage?.getItem('tz_current_journal'); } catch(e){ return null; } })();

// ── State ────────────────────────────────────────────────────────────
let currentUser    = null;
let userIsPro      = false;
let journalSettings = null;
let psSettings     = null;
let currentSession = null;
let currentDate    = todayLocal();
let activePsTab    = 'plan';
let dirtyTabs      = new Set();
let intentDir      = 'Long';
let editingIntentId = null;
let intents        = [];
let sessionHistory = [];

// ── Factory Templates ────────────────────────────────────────────────
const FACTORY_TEMPLATES = {
  scalping: {
    name: 'Scalping', icon: 'fa-solid fa-bolt',
    desc: 'Fast-paced intraday, tight risk',
    items: [
      { text: 'Checked economic calendar for high-impact news', cat: 'mindset' },
      { text: 'Confirmed session overlap (London/NY)', cat: 'technical' },
      { text: 'Identified at least 2 key price levels', cat: 'technical' },
      { text: 'Spread is within acceptable range', cat: 'risk' },
      { text: 'Risk per trade set to ≤1%', cat: 'risk' },
      { text: 'Stop loss placed, not mental', cat: 'risk' },
      { text: 'No overtrading — max 3 losses today', cat: 'execution' },
      { text: 'Not chasing missed moves', cat: 'mindset' },
      { text: 'Emotions are neutral, not tilted', cat: 'mindset' },
      { text: 'Setup aligns with bias direction', cat: 'execution' },
    ]
  },
  swing: {
    name: 'Swing', icon: 'fa-solid fa-chart-area',
    desc: 'Multi-day holds, higher TF confluence',
    items: [
      { text: 'Weekly and daily structure analyzed', cat: 'technical' },
      { text: 'Trade aligns with higher timeframe bias', cat: 'technical' },
      { text: 'Identified premium/discount zones', cat: 'technical' },
      { text: 'Risk per trade set to ≤2%', cat: 'risk' },
      { text: 'Stop loss accounts for weekly volatility', cat: 'risk' },
      { text: 'Minimum 1:3 R:R confirmed', cat: 'execution' },
      { text: 'Not affected by short-term noise', cat: 'mindset' },
      { text: 'News events checked for hold duration', cat: 'technical' },
      { text: 'Position size calculated correctly', cat: 'risk' },
      { text: 'Trade thesis is clear and documented', cat: 'execution' },
    ]
  },
  ict: {
    name: 'ICT / SMC', icon: 'fa-solid fa-brain',
    desc: 'Smart money concepts, liquidity, OBs',
    items: [
      { text: 'Identified draw on liquidity (DOL)', cat: 'technical' },
      { text: 'Market structure shift (MSS) confirmed', cat: 'technical' },
      { text: 'FVG or OB identified as entry model', cat: 'technical' },
      { text: 'Entry during kill zone (London/NY open)', cat: 'execution' },
      { text: 'Stop loss below/above structural point', cat: 'risk' },
      { text: 'Minimum 1:2 R:R confirmed', cat: 'risk' },
      { text: 'Checked for inducement / liquidity grab', cat: 'technical' },
      { text: 'DXY correlation checked', cat: 'technical' },
      { text: 'No trading during NY lunch (12–13 EST)', cat: 'mindset' },
      { text: 'IPDA range considered for targets', cat: 'execution' },
    ]
  }
};

// ── Helpers ──────────────────────────────────────────────────────────
function todayLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function fmtDateDisplay(ds) {
  if (!ds) return '—';
  const [y, m, d] = ds.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dt = new Date(y, m-1, d);
  const isToday = ds === todayLocal();
  return (isToday ? 'Today — ' : days[dt.getDay()] + ' ') + months[m-1] + ' ' + d + ', ' + y;
}
function getThresholds() { return { ok: psSettings?.thresholds?.ok ?? 70, good: psSettings?.thresholds?.good ?? 85 }; }
function scoreColor(pct) {
  const { ok, good } = getThresholds();
  if (pct >= good) return 'var(--accent2)';
  if (pct >= ok)   return '#f59e0b';
  return '#ff5f6d';
}
function scoreLabel(pct) {
  const { ok, good } = getThresholds();
  if (pct >= good) return 'Good to trade';
  if (pct >= ok)   return 'Proceed with caution';
  if (pct > 0)     return 'Not ready — review items';
  return 'Complete the checklist below';
}
function esc(s) { const d = document.createElement('div'); d.textContent = String(s||''); return d.innerHTML; }

let _tt;
function showToast(msg, icon='fa-solid fa-circle-check', type='') {
  const t = document.getElementById('toast');
  document.getElementById('toastIcon').className = icon;
  document.getElementById('toastMsg').textContent = msg;
  t.className = 'show' + (type==='green'?' toast-green':type==='red'?' toast-red':'');
  clearTimeout(_tt);
  _tt = setTimeout(() => t.classList.remove('show','toast-green','toast-red'), 3500);
}
function markDirty(tab) {
  dirtyTabs.add(tab);
  const el = document.getElementById(tab + 'Dirty');
  if (el) el.innerHTML = '<i class="fa-solid fa-circle" style="font-size:6px"></i> Unsaved changes';
}
function clearDirty(tab) {
  dirtyTabs.delete(tab);
  const el = document.getElementById(tab + 'Dirty');
  if (el) el.innerHTML = '';
}

// ══════════════════════════════════════════════════════════════════════
//  INIT — same pattern as logs.js
// ══════════════════════════════════════════════════════════════════════
(async () => {
  const { data: { user } } = await db.auth.getUser();
  currentUser = user;
  if (!currentUser || !jid) { showToast('Session expired.','fa-solid fa-circle-exclamation','red'); return; }

  try { userIsPro = parent?._userIsPro || false; } catch(e) {}
  if (!userIsPro) { const p = await getProfile(currentUser.id); userIsPro = p?.plan === 'pro'; }

  journalSettings = await getJournalSettings(jid);
  psSettings = await getPsSettings();

  await loadSession(currentDate);

  renderBanner();
  renderCustomize();
  renderReflectMoods();
  updateChecklistBadge();

  document.body.style.visibility = 'visible';
})();

// ══════════════════════════════════════════════════════════════════════
//  SUPABASE: PRESESSION SETTINGS
// ══════════════════════════════════════════════════════════════════════
async function getPsSettings() {
  const { data, error } = await db.from('presession_settings').select('*').eq('journal_id', jid).maybeSingle();
  if (error) console.error('[ps] getPsSettings:', error);
  if (!data) {
    const defaults = {
      journal_id: jid, user_id: currentUser.id,
      active_template: 'scalping',
      checklist_items: FACTORY_TEMPLATES.scalping.items,
      setup_library: ['Break & Retest','FVG Fill','Order Block','Trend Continuation','Liquidity Grab','Reversal'],
      templates: {},
      feature_toggles: { banner:true, tradeLock:true, autofill:true, reflectReminder:false },
      thresholds: { ok:70, good:85 }
    };
    const { data: created } = await db.from('presession_settings').upsert(defaults, { onConflict:'journal_id' }).select('*').maybeSingle();
    return created || defaults;
  }
  return data;
}
async function savePsSettings(updates) {
  const { error } = await db.from('presession_settings').update(updates).eq('journal_id', jid);
  if (error) throw error;
  Object.assign(psSettings, updates);
}

// ══════════════════════════════════════════════════════════════════════
//  SUPABASE: SESSION CRUD
// ══════════════════════════════════════════════════════════════════════
async function loadSession(date) {
  document.getElementById('psSubtitle').textContent = fmtDateDisplay(date);

  let { data } = await db.from('pre_sessions').select('*').eq('journal_id', jid).eq('session_date', date).maybeSingle();

  if (!data) {
    const { data: created } = await db.from('pre_sessions').upsert({
      journal_id: jid, user_id: currentUser.id, session_date: date,
      bias: null, bias_reason: '', key_levels: [], session_goals: '', rules: [],
      checklist_state: {}, checklist_score: 0,
      checklist_snapshot: JSON.stringify(psSettings?.checklist_items || []),
      reflect_mood: null, reflect_well: '', reflect_wrong: '', reflect_lesson: '', rules_broken: []
    }, { onConflict: 'journal_id,session_date' }).select('*').maybeSingle();
    data = created;
  }

  currentSession = data;
  await loadIntents(date);
  await loadHistory();

  populatePlan();
  populateChecklist();
  populateReflect();
  renderBanner();
  updateChecklistBadge();
  dirtyTabs.clear();
  ['plan','checklist','reflect'].forEach(t => clearDirty(t));
  broadcastSessionSummary();
}

async function upsertSession(updates) {
  if (!currentSession?.id) return;
  const { error } = await db.from('pre_sessions').update(updates).eq('id', currentSession.id);
  if (error) throw error;
  Object.assign(currentSession, updates);
}

// ══════════════════════════════════════════════════════════════════════
//  SUPABASE: TRADE INTENTS
// ══════════════════════════════════════════════════════════════════════
async function loadIntents(date) {
  if (!currentSession?.id) { intents = []; renderIntents(); return; }
  const { data } = await db.from('trade_intents').select('*').eq('pre_session_id', currentSession.id).order('created_at', { ascending: true });
  intents = data || [];
  renderIntents();
}
async function loadHistory() {
  const { data } = await db.from('pre_sessions').select('session_date,checklist_score').eq('journal_id', jid).order('session_date', { ascending: false }).limit(10);
  sessionHistory = (data || []).reverse();
  renderHistory();
}

// ══════════════════════════════════════════════════════════════════════
//  SESSION BROADCAST
// ══════════════════════════════════════════════════════════════════════
function broadcastSessionSummary() {
  if (!(psSettings?.feature_toggles?.autofill ?? true)) return;
  const activeIntents = intents.filter(i => !i.trade_id);
  try {
    parent.postMessage({
      type: 'tz_presession_summary',
      date: currentDate,
      checklist_score: currentSession?.checklist_score || 0,
      bias: currentSession?.bias || null,
      active_intents: activeIntents.map(i => ({
        id: i.id,
        setup_name: i.setup_name,
        direction: i.direction,
        entry_price: i.entry_price,
        stop_loss:   i.stop_loss,
        take_profit: i.take_profit,
        why_trade:   i.why_trade
      }))
    }, '*');
  } catch(e) {}
}

// ══════════════════════════════════════════════════════════════════════
//  DATE NAVIGATION
// ══════════════════════════════════════════════════════════════════════
function navSession(dir) {
  const d = new Date(currentDate + 'T12:00:00');
  d.setDate(d.getDate() + dir);
  currentDate = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  loadSession(currentDate);
}
function goToday() { currentDate = todayLocal(); loadSession(currentDate); }

// ══════════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════════════════════
function switchPsTab(name) {
  activePsTab = name;
  document.querySelectorAll('.ps-tab').forEach(t => t.classList.toggle('active', t.dataset.pstab === name));
  document.querySelectorAll('.ps-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  if (name === 'intent') renderIntentLockBar();
}

// ══════════════════════════════════════════════════════════════════════
//  SESSION BANNER
// ══════════════════════════════════════════════════════════════════════
function renderBanner() {
  const toggles = psSettings?.feature_toggles || {};
  const banner  = document.getElementById('sessionBanner');
  if (!toggles.banner) { banner.style.display = 'none'; return; }
  banner.style.display = '';

  const bias  = currentSession?.bias || '—';
  const score = currentSession?.checklist_score || 0;
  const dot   = document.getElementById('sbDot');
  dot.className = 'sb-dot ' + (bias||'').toLowerCase();
  document.getElementById('sbBias').textContent = bias;

  const fill = document.getElementById('sbFill');
  fill.style.width    = score + '%';
  fill.style.background = scoreColor(score);
  document.getElementById('sbScoreVal').textContent = score ? score + '%' : '—';

  const isToday = currentDate === todayLocal();
  const phase = isToday ? (score > 0 ? 'Session active' : 'Plan your session') : (currentDate < todayLocal() ? 'Past session' : 'Future session');
  document.getElementById('sbPhase').textContent = phase;
}

// ══════════════════════════════════════════════════════════════════════
//  PLAN TAB
// ══════════════════════════════════════════════════════════════════════
function populatePlan() {
  const s = currentSession; if (!s) return;
  document.querySelectorAll('.bias-btn').forEach(btn => {
    btn.className = 'bias-btn' + (s.bias === btn.dataset.bias ? ' active-' + btn.dataset.bias.toLowerCase() : '');
  });
  document.getElementById('biasReason').value   = s.bias_reason   || '';
  document.getElementById('sessionGoals').value = s.session_goals || '';
  renderLevels(s.key_levels || []);
  renderRules(s.rules || []);
}
function setBias(val) {
  if (!currentSession) return;
  currentSession.bias = currentSession.bias === val ? null : val;
  document.querySelectorAll('.bias-btn').forEach(btn => {
    btn.className = 'bias-btn' + (currentSession.bias === btn.dataset.bias ? ' active-' + btn.dataset.bias.toLowerCase() : '');
  });
  markDirty('plan'); renderBanner();
}
function renderLevels(levels) {
  const list = document.getElementById('levelsList'); list.innerHTML = '';
  (levels||[]).forEach((lv, i) => {
    const row = document.createElement('div'); row.className = 'level-row';
    row.innerHTML = `
      <div class="level-tag">
        <button class="level-tag-btn${lv.tag==='S'?' active-S':''}" onclick="setLevelTag(${i},'S')">S</button>
        <button class="level-tag-btn${lv.tag==='R'?' active-R':''}" onclick="setLevelTag(${i},'R')">R</button>
        <button class="level-tag-btn${lv.tag==='POI'?' active-POI':''}" onclick="setLevelTag(${i},'POI')">POI</button>
      </div>
      <input class="level-label-input" value="${esc(lv.label||'')}" placeholder="Description…" oninput="updateLevel(${i},'label',this.value)">
      <input class="level-price-input" type="number" step="any" value="${lv.price||''}" placeholder="Price" oninput="updateLevel(${i},'price',this.value)">
      <button class="row-rm" onclick="removeLevel(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    list.appendChild(row);
  });
}
function addLevel() { if (!currentSession) return; const l = currentSession.key_levels || []; l.push({ tag:'S', label:'', price:'' }); currentSession.key_levels = l; renderLevels(l); markDirty('plan'); }
function removeLevel(i) { currentSession.key_levels.splice(i,1); renderLevels(currentSession.key_levels); markDirty('plan'); }
function updateLevel(i, field, val) { if (currentSession.key_levels[i]) { currentSession.key_levels[i][field] = val; markDirty('plan'); } }
function setLevelTag(i, tag) { if (currentSession.key_levels[i]) { currentSession.key_levels[i].tag = tag; renderLevels(currentSession.key_levels); markDirty('plan'); } }
function renderRules(rules) {
  const list = document.getElementById('rulesList'); list.innerHTML = '';
  (rules||[]).forEach((r, i) => {
    const row = document.createElement('div'); row.className = 'rule-row';
    row.innerHTML = `<input class="rule-input" value="${esc(r.text||'')}" placeholder="e.g. No trading below 3-star mood…" oninput="updateRule(${i},this.value)"><button class="row-rm" onclick="removeRule(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    list.appendChild(row);
  });
}
function addRule() { if (!currentSession) return; const r = currentSession.rules || []; r.push({ text:'', broken:false }); currentSession.rules = r; renderRules(r); markDirty('plan'); }
function removeRule(i) { currentSession.rules.splice(i,1); renderRules(currentSession.rules); markDirty('plan'); }
function updateRule(i, val) { if (currentSession.rules[i]) { currentSession.rules[i].text = val; markDirty('plan'); } }
async function savePlan() {
  if (!currentSession) return;
  try {
    await upsertSession({ bias: currentSession.bias, bias_reason: document.getElementById('biasReason').value, session_goals: document.getElementById('sessionGoals').value, key_levels: currentSession.key_levels || [], rules: currentSession.rules || [] });
    clearDirty('plan'); renderBanner(); renderRulesBroken();
    showToast('Plan saved!', 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Save failed: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}

// ══════════════════════════════════════════════════════════════════════
//  CHECKLIST TAB
// ══════════════════════════════════════════════════════════════════════
function getChecklistItems() {
  const isToday = currentDate === todayLocal();
  if (!isToday && currentSession?.checklist_snapshot) {
    try { return JSON.parse(currentSession.checklist_snapshot); } catch(e) {}
  }
  return psSettings?.checklist_items || FACTORY_TEMPLATES.scalping.items;
}
function populateChecklist() { renderChecklistItems(); updateChecklistScore(); }
function renderChecklistItems() {
  const items = getChecklistItems();
  const state = currentSession?.checklist_state || {};
  const el = document.getElementById('clItems'); el.innerHTML = '';
  const cats = ['mindset','technical','risk','execution'];
  const catLabels = { mindset:'Mindset', technical:'Technical', risk:'Risk Management', execution:'Execution' };
  cats.forEach(cat => {
    const catItems = items.filter(it => it.cat === cat);
    if (!catItems.length) return;
    const lbl = document.createElement('div'); lbl.className = 'cl-category-label'; lbl.textContent = catLabels[cat]; el.appendChild(lbl);
    catItems.forEach(item => {
      const idx = items.indexOf(item);
      const checked = !!state[idx];
      const div = document.createElement('div');
      div.className = 'cl-item' + (checked ? ' checked' : '');
      const isCritical = item.weight >= 2;
      div.innerHTML = `<div class="cl-item-check">${checked ? '<i class="fa-solid fa-check"></i>' : ''}</div><div class="cl-item-text">${esc(item.text)}${isCritical ? ' <span class="cl-critical-badge">Critical</span>' : ''}</div><span class="cl-item-cat">${esc(item.cat)}</span>`;
      const isPast = currentDate !== todayLocal();
      if (!isPast) {
        div.addEventListener('click', () => toggleChecklistItem(idx));
      } else {
        div.classList.add('cl-item-past');
      }
      el.appendChild(div);
    });
  });
}
function toggleChecklistItem(idx) {
  if (!currentSession) return;
  if (!currentSession.checklist_state) currentSession.checklist_state = {};
  currentSession.checklist_state[idx] = !currentSession.checklist_state[idx];
  renderChecklistItems(); updateChecklistScore(); markDirty('checklist');
}
function updateChecklistScore() {
  const items = getChecklistItems();
  const state = currentSession?.checklist_state || {};
  let totalWeight = 0, doneWeight = 0;
  items.forEach((item, idx) => {
    const w = item.weight || 1;
    totalWeight += w;
    if (state[idx]) doneWeight += w;
  });
  const done = Object.values(state).filter(Boolean).length;
  const pct  = totalWeight ? Math.round((doneWeight / totalWeight) * 100) : 0;
  if (currentSession) currentSession.checklist_score = pct;

  const circ = 2 * Math.PI * 34;
  const fill = document.getElementById('clRingFill');
  const col  = scoreColor(pct);
  if (fill) { fill.style.strokeDashoffset = circ - (pct/100) * circ; fill.style.stroke = col; }
  document.getElementById('clScorePct').textContent    = pct ? pct + '%' : '—';
  document.getElementById('clScoreStatus').textContent = scoreLabel(pct);
  document.getElementById('clScoreCounts').textContent  = items.length ? `${done} / ${items.length} items` : '';
  const qBar = document.getElementById('clQualityBar');
  if (qBar) {
    const { ok, good } = getThresholds();
    qBar.textContent = pct >= good ? 'Good' : pct >= ok ? 'OK' : pct > 0 ? 'Poor' : '—';
    qBar.style.color = col; qBar.style.borderColor = col + '55';
  }
  updateChecklistBadge(); renderIntentLockBar(); renderBanner(); renderCategoryBreakdown();
}
function updateChecklistBadge() {
  const items = getChecklistItems();
  const state = currentSession?.checklist_state || {};
  const done  = Object.values(state).filter(Boolean).length;
  const total = items.length;
  const badge = document.getElementById('checklistBadge'); if (!badge) return;
  if (total && done === total) { badge.textContent = '✓'; badge.style.display = ''; }
  else if (total) { badge.textContent = `${done}/${total}`; badge.style.display = ''; }
  else { badge.style.display = 'none'; }
}
async function saveChecklist() {
  if (!currentSession) return;
  try {
    const items = getChecklistItems();
    const state = currentSession.checklist_state || {};
    const done  = Object.values(state).filter(Boolean).length;
    const pct   = items.length ? Math.round((done / items.length) * 100) : 0;
    await upsertSession({ checklist_state: state, checklist_score: pct, checklist_snapshot: JSON.stringify(items) });
    clearDirty('checklist'); renderBanner(); await loadHistory();
    showToast('Checklist saved!', 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Save failed: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}
function renderHistory() {
  const el = document.getElementById('clHistoryBars'); if (!el) return;
  const rows = sessionHistory.filter(s => s.checklist_score > 0);
  if (!rows.length) { el.innerHTML = '<div class="cl-history-empty">Complete sessions to see history</div>'; return; }
  el.innerHTML = '';
  rows.slice(-8).forEach(s => {
    const pct = s.checklist_score || 0;
    const col = scoreColor(pct);
    const [,m,d] = (s.session_date||'').split('-');
    const row = document.createElement('div'); row.className = 'cl-history-bar-row';
    row.innerHTML = `<span class="cl-hbar-date">${m}/${d}</span><div class="cl-hbar-wrap"><div class="cl-hbar-fill" style="width:${pct}%;background:${col}"></div></div><span class="cl-hbar-pct">${pct}%</span>`;
    el.appendChild(row);
  });
  renderStreak();
}
function calcStreak() {
  const { good } = getThresholds();
  let streak = 0;
  for (let i = sessionHistory.length - 1; i >= 0; i--) {
    if ((sessionHistory[i].checklist_score || 0) >= good) streak++;
    else break;
  }
  return streak;
}
function renderStreak() {
  const el = document.getElementById('clStreakDisplay'); if (!el) return;
  const streak = calcStreak();
  const { good } = getThresholds();
  el.innerHTML = streak > 0
    ? `<i class="fa-solid fa-fire" style="color:#f59e0b"></i> <strong>${streak}</strong> session streak above ${good}%`
    : `<span style="color:var(--muted)">No current streak</span>`;
}
function renderCategoryBreakdown() {
  const items = getChecklistItems();
  const state = currentSession?.checklist_state || {};
  const cats  = ['mindset','technical','risk','execution'];
  const catLabels = { mindset:'Mindset', technical:'Technical', risk:'Risk', execution:'Execution' };
  const el = document.getElementById('clCatBreakdown'); if (!el) return;
  el.innerHTML = '';
  cats.forEach(cat => {
    const catItems = items.map((it,i) => ({...it,i})).filter(it => it.cat === cat);
    if (!catItems.length) return;
    const done  = catItems.filter(it => state[it.i]).length;
    const total = catItems.length;
    const pct   = Math.round((done/total)*100);
    const col   = scoreColor(pct);
    const row = document.createElement('div');
    row.className = 'cl-cat-row';
    row.innerHTML = `<span class="cl-cat-name">${catLabels[cat]}</span><div class="cl-cat-bar"><div class="cl-cat-fill" style="width:${pct}%;background:${col}"></div></div><span class="cl-cat-pct" style="color:${col}">${done}/${total}</span>`;
    el.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════════════════
//  INTENT TAB
// ══════════════════════════════════════════════════════════════════════
function renderIntentLockBar() {
  if (!currentSession) return;
  const bar = document.getElementById('intentLockBar');
  const score = currentSession.checklist_score || 0;
  const { ok, good } = getThresholds();
  if (!(psSettings?.feature_toggles?.tradeLock ?? true)) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  let cls, icon, title, sub, badge;
  if (score === 0)        { cls='lock-red';   icon='fa-solid fa-triangle-exclamation'; title='Checklist not completed'; sub='Complete your checklist before trading'; badge='Not ready'; }
  else if (score < ok)    { cls='lock-red';   icon='fa-solid fa-shield-halved'; title='Checklist score is low'; sub=`Score: ${score}% — review your setup`; badge=score+'% — Poor'; }
  else if (score < good)  { cls='lock-amber'; icon='fa-solid fa-triangle-exclamation'; title='Proceed with caution'; sub=`Score: ${score}% — trade carefully`; badge=score+'% — OK'; }
  else                    { cls='lock-green'; icon='fa-solid fa-shield-halved'; title='Ready to trade'; sub=`Checklist score: ${score}%`; badge=score+'% — Good'; }
  bar.className = 'intent-lock-bar ' + cls;
  document.getElementById('ilbIcon').className = icon;
  document.getElementById('ilbTitle').textContent = title;
  document.getElementById('ilbSub').textContent   = sub;
  document.getElementById('ilbBadge').textContent = badge;
}
function renderIntents() {
  const count = intents.length;
  document.getElementById('intentCount').textContent = count + (count === 1 ? ' intent' : ' intents') + ' today';
  const list  = document.getElementById('intentList');
  const empty = document.getElementById('intentEmpty');
  if (!count) { empty.style.display = ''; list.innerHTML = ''; list.appendChild(empty); return; }
  empty.style.display = 'none'; list.innerHTML = '';
  const statusColors = { watching:'#8fa39a', ready:'#f59e0b', executed:'var(--accent2)', cancelled:'#ff5f6d' };
  const statusIcons  = { watching:'fa-eye', ready:'fa-bullseye', executed:'fa-check', cancelled:'fa-ban' };
  intents.forEach(intent => {
    const rr  = calcRR(intent.entry_price, intent.stop_loss, intent.take_profit);
    const score = currentSession?.checklist_score || 0;
    const col   = scoreColor(score);
    const card  = document.createElement('div');
    card.className = 'intent-card';
    card.dataset.id = intent.id;
    const rrText = rr ? '1:' + rr.toFixed(2) + 'R' : '';
    const status = intent.status || 'watching';
    const sCol   = statusColors[status] || '#8fa39a';
    const sIcon  = statusIcons[status]  || 'fa-eye';
    card.innerHTML = `
      <div class="intent-card-hdr" onclick="toggleIntentCard('${intent.id}')">
        <div class="ic-left">
          <span class="ic-setup">${esc(intent.setup_name||'Unnamed')}</span>
          <span class="ic-dir ${(intent.direction||'Long').toLowerCase()}">${esc(intent.direction||'Long')}</span>
          ${rrText ? `<span class="ic-rr">${rrText}</span>` : ''}
          <span class="ic-score" style="color:${col};background:${col}18;border:1px solid ${col}44">${score}%</span>
          <span class="ic-status" style="color:${sCol};border-color:${sCol}55;background:${sCol}11" onclick="event.stopPropagation();cycleIntentStatus('${intent.id}')"><i class="fa-solid ${sIcon}"></i> ${status}</span>
        </div>
        <div class="ic-actions">
          <button class="ic-btn" onclick="event.stopPropagation();editIntent('${intent.id}')"><i class="fa-solid fa-pencil"></i></button>
          <button class="ic-btn del" onclick="event.stopPropagation();deleteIntent('${intent.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div class="intent-card-body">
        <div class="icb-row">
          ${intent.entry_price ? `<div class="icb-field"><div class="icb-lbl">Entry</div><div class="icb-val">$${parseFloat(intent.entry_price).toFixed(5)}</div></div>` : ''}
          ${intent.stop_loss   ? `<div class="icb-field"><div class="icb-lbl">Stop Loss</div><div class="icb-val">$${parseFloat(intent.stop_loss).toFixed(5)}</div></div>` : ''}
          ${intent.take_profit ? `<div class="icb-field"><div class="icb-lbl">Take Profit</div><div class="icb-val">$${parseFloat(intent.take_profit).toFixed(5)}</div></div>` : ''}
        </div>
        ${intent.why_trade    ? `<div class="icb-text"><strong>Why:</strong> ${esc(intent.why_trade)}</div>` : ''}
        ${intent.invalidation ? `<div class="icb-text" style="margin-top:5px"><strong>Invalid if:</strong> ${esc(intent.invalidation)}</div>` : ''}
      </div>`;
    list.appendChild(card);
  });
}
function toggleIntentCard(id) {
  const card = document.querySelector(`.intent-card[data-id="${id}"]`);
  if (card) card.classList.toggle('open');
}
function calcRR(entry, sl, tp) {
  const e = parseFloat(entry), s = parseFloat(sl), t = parseFloat(tp);
  if (!e || !s || !t || isNaN(e) || isNaN(s) || isNaN(t)) return null;
  const risk = Math.abs(e - s), reward = Math.abs(t - e);
  return risk ? reward / risk : null;
}
function calcIntentRR() {
  const rr = calcRR(document.getElementById('ifEntry').value, document.getElementById('ifSL').value, document.getElementById('ifTP').value);
  const disp = document.getElementById('ifRRDisplay');
  if (!rr) { if (disp) disp.style.display = 'none'; return; }
  if (disp) disp.style.display = '';
  const col = rr >= 3 ? 'var(--accent2)' : rr >= 2 ? '#f59e0b' : '#ff5f6d';
  document.getElementById('ifRRVal').textContent = '1 : ' + rr.toFixed(2);
  document.getElementById('ifRRVal').style.color = col;
  const fill = document.getElementById('ifRRFill');
  fill.style.width = Math.min((rr/3)*100, 100) + '%'; fill.style.background = col;
}
function newIntent() {
  editingIntentId = null; intentDir = 'Long';
  document.getElementById('intentFormTitle').textContent = 'New Trade Intent';
  document.getElementById('ifSetup').value = ''; document.getElementById('ifWhy').value = '';
  document.getElementById('ifEntry').value = ''; document.getElementById('ifSL').value = ''; document.getElementById('ifTP').value = '';
  document.getElementById('ifInvalidation').value = ''; document.getElementById('ifRRDisplay').style.display = 'none';
  setIntentDir('Long'); populateSetupSelect();
  document.getElementById('intentFormWrap').style.display = '';
  document.getElementById('intentFormWrap').scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function editIntent(id) {
  const intent = intents.find(i => i.id === id); if (!intent) return;
  editingIntentId = id;
  document.getElementById('intentFormTitle').textContent = 'Edit Trade Intent';
  populateSetupSelect();
  document.getElementById('ifSetup').value        = intent.setup_name || '';
  intentDir = intent.direction || 'Long'; setIntentDir(intentDir);
  document.getElementById('ifWhy').value          = intent.why_trade || '';
  document.getElementById('ifEntry').value        = intent.entry_price || '';
  document.getElementById('ifSL').value           = intent.stop_loss || '';
  document.getElementById('ifTP').value           = intent.take_profit || '';
  document.getElementById('ifInvalidation').value = intent.invalidation || '';
  calcIntentRR();
  document.getElementById('intentFormWrap').style.display = '';
  document.getElementById('intentFormWrap').scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function cancelIntent() { editingIntentId = null; document.getElementById('intentFormWrap').style.display = 'none'; }
function setIntentDir(dir) {
  intentDir = dir;
  document.getElementById('ifLong').classList.toggle('active',  dir === 'Long');
  document.getElementById('ifShort').classList.toggle('active', dir === 'Short');
}
function populateSetupSelect() {
  const sel = document.getElementById('ifSetup');
  const setups = psSettings?.setup_library || [];
  sel.innerHTML = '<option value="">— Choose setup —</option>';
  setups.forEach(s => { const opt = document.createElement('option'); opt.value = s; opt.textContent = s; sel.appendChild(opt); });
}
async function saveIntent() {
  const setup = document.getElementById('ifSetup').value;
  if (!setup) { showToast('Please select a setup name.','fa-solid fa-triangle-exclamation','red'); return; }
  if (!currentSession?.id) return;
  const existingIntent = editingIntentId ? intents.find(i => i.id === editingIntentId) : null;
  const payload = {
    pre_session_id: currentSession.id, journal_id: jid, user_id: currentUser.id,
    setup_name: setup, direction: intentDir,
    why_trade: document.getElementById('ifWhy').value,
    entry_price: parseFloat(document.getElementById('ifEntry').value) || null,
    stop_loss:   parseFloat(document.getElementById('ifSL').value)    || null,
    take_profit: parseFloat(document.getElementById('ifTP').value)    || null,
    invalidation: document.getElementById('ifInvalidation').value,
    checklist_score: currentSession.checklist_score || 0,
    checklist_snapshot: JSON.stringify(psSettings?.checklist_items || []),
    status: existingIntent?.status || 'watching'
  };
  try {
    if (editingIntentId) {
      await db.from('trade_intents').update(payload).eq('id', editingIntentId);
      const idx = intents.findIndex(i => i.id === editingIntentId);
      if (idx > -1) intents[idx] = { ...intents[idx], ...payload };
    } else {
      const { data } = await db.from('trade_intents').insert(payload).select('*').single();
      if (data) intents.push(data);
    }
    cancelIntent(); renderIntents(); broadcastSessionSummary();
    showToast('Trade intent saved!', 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Save failed: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}
async function deleteIntent(id) {
  if (!confirm('Delete this trade intent?')) return;
  try {
    await db.from('trade_intents').delete().eq('id', id);
    intents = intents.filter(i => i.id !== id); renderIntents(); broadcastSessionSummary();
    showToast('Intent deleted.', 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Error: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}
async function cycleIntentStatus(id) {
  const order = ['watching','ready','executed','cancelled'];
  const intent = intents.find(i => i.id === id); if (!intent) return;
  const next = order[(order.indexOf(intent.status || 'watching') + 1) % order.length];
  try {
    await db.from('trade_intents').update({ status: next }).eq('id', id);
    intent.status = next; renderIntents(); broadcastSessionSummary();
  } catch(e) { showToast('Error: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}

// ══════════════════════════════════════════════════════════════════════
//  REFLECT TAB
// ══════════════════════════════════════════════════════════════════════
function populateReflect() {
  const s = currentSession; if (!s) return;
  document.getElementById('reflectWell').value   = s.reflect_well   || '';
  document.getElementById('reflectWrong').value  = s.reflect_wrong  || '';
  document.getElementById('reflectLesson').value = s.reflect_lesson || '';
  renderReflectMoods(s.reflect_mood);
  renderRulesBroken();
  renderAutoInsights();
  loadWeeklySummary();
}
function renderReflectMoods(selected) {
  const moods  = journalSettings?.moods || ['Confident','Neutral','Anxious'];
  const colors = journalSettings?.mood_colors || {};
  const row    = document.getElementById('reflectMoodRow'); if (!row) return;
  row.innerHTML = '';
  moods.forEach(m => {
    const col = colors[m] || '#8fa39a';
    const [r,g,b] = [col.slice(1,3),col.slice(3,5),col.slice(5,7)].map(x=>parseInt(x,16));
    const pill = document.createElement('div');
    pill.className = 'mood-pill' + (selected === m ? ' selected' : '');
    pill.textContent = m;
    if (selected === m) pill.style.cssText = `background:rgba(${r},${g},${b},.18);color:${col};border-color:rgba(${r},${g},${b},.5)`;
    pill.addEventListener('click', () => {
      currentSession.reflect_mood = currentSession.reflect_mood === m ? null : m;
      renderReflectMoods(currentSession.reflect_mood); markDirty('reflect');
    });
    row.appendChild(pill);
  });
}
function renderRulesBroken() {
  const list   = document.getElementById('rulesBrokenList');
  const rules  = currentSession?.rules || [];
  const broken = currentSession?.rules_broken || [];
  if (!rules.length) { list.innerHTML = '<div style="font-size:12px;color:var(--muted)">Save your plan rules first, then mark any you broke.</div>'; return; }
  list.innerHTML = '';
  rules.forEach((r, i) => {
    if (!r.text) return;
    const isBroken = broken.includes(i);
    const row = document.createElement('div');
    row.className = 'rule-broken-row' + (isBroken ? ' broken' : '');
    row.innerHTML = `<div class="rbr-check">${isBroken ? '<i class="fa-solid fa-xmark" style="font-size:8px"></i>' : ''}</div><div class="rbr-text">${esc(r.text)}</div>`;
    row.addEventListener('click', () => {
      const rb = currentSession.rules_broken || [];
      const idx = rb.indexOf(i);
      if (idx > -1) rb.splice(idx, 1); else rb.push(i);
      currentSession.rules_broken = rb; renderRulesBroken(); markDirty('reflect');
    });
    list.appendChild(row);
  });
}
async function loadRulesBrokenHistory() {
  const { data } = await db.from('pre_sessions')
    .select('rules,rules_broken')
    .eq('journal_id', jid)
    .order('session_date', { ascending: false })
    .limit(30);
  const counts = {};
  (data || []).forEach(s => {
    const rules  = s.rules  || [];
    const broken = s.rules_broken || [];
    broken.forEach(idx => {
      const text = rules[idx]?.text;
      if (text) counts[text] = (counts[text] || 0) + 1;
    });
  });
  return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,5);
}
async function renderAutoInsights() {
  const el = document.getElementById('autoInsights');
  const count = sessionHistory.length;
  if (count < 2) {
    el.innerHTML = `<div class="ai-placeholder"><i class="fa-solid fa-chart-simple" style="font-size:22px;opacity:.2;display:block;margin-bottom:8px"></i>Build up ${Math.max(0,2-count)} more session${2-count!==1?'s':''} to unlock insights.</div>`;
    return;
  }
  const insights = [];
  const scores = sessionHistory.map(s => s.checklist_score || 0);
  const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
  insights.push(`Average checklist score: <strong>${avg}%</strong> over ${count} session${count!==1?'s':''}`);
  if (count >= 4) {
    const recent = scores.slice(-2).reduce((a,b)=>a+b,0)/2;
    const prior  = scores.slice(-4,-2).reduce((a,b)=>a+b,0)/2;
    const delta  = Math.round(recent - prior);
    const dir    = delta > 0 ? '↑ improving' : delta < 0 ? '↓ declining' : '→ stable';
    const dcol   = delta > 0 ? 'var(--accent2)' : delta < 0 ? '#ff5f6d' : '#f59e0b';
    insights.push(`Recent trend: <strong style="color:${dcol}">${dir} (${delta > 0 ? '+' : ''}${delta}%)</strong>`);
  }
  const biases = sessionHistory.map(s=>s.bias).filter(Boolean);
  if (biases.length) {
    const top = Object.entries(biases.reduce((a,b)=>{a[b]=(a[b]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1])[0];
    insights.push(`Most common bias: <strong>${top[0]}</strong> (${top[1]} session${top[1]!==1?'s':''})`);
  }
  if (count >= 5) {
    const broken = await loadRulesBrokenHistory();
    if (broken.length) insights.push(`Most broken rule: <strong>"${esc(broken[0][0])}"</strong> (${broken[0][1]}×)`);
  }
  el.innerHTML = insights.map(text =>
    `<div class="ai-insight"><i class="fa-solid fa-chart-line"></i><div class="ai-insight-text">${text}</div></div>`
  ).join('');
}
async function loadWeeklySummary() {
  const { data } = await db.from('pre_sessions')
    .select('id,session_date,bias,checklist_score,reflect_lesson,rules_broken')
    .eq('journal_id', jid)
    .order('session_date', { ascending: false })
    .limit(5);
  renderWeeklySummary(data || []);
}
function renderWeeklySummary(rows) {
  const el = document.getElementById('weeklySummaryTable'); if (!el) return;
  if (!rows.length) { el.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:10px 0">No sessions yet.</div>'; return; }
  const biasChipColor = { Bullish:'#19c37d', Bearish:'#ff5f6d', Neutral:'#f59e0b', Wait:'var(--muted)' };
  el.innerHTML = `<table class="ws-table">
    <thead><tr><th>Date</th><th>Bias</th><th>Score</th><th>Rules Broken</th><th>Reflect</th></tr></thead>
    <tbody>${rows.map(s => {
      const bCol = biasChipColor[s.bias] || 'var(--muted)';
      const pct  = s.checklist_score || 0;
      const sCol = scoreColor(pct);
      return `<tr>
        <td style="font-size:11px;color:var(--muted)">${fmtDateDisplay(s.session_date)}</td>
        <td>${s.bias ? `<span class="ws-bias-chip" style="color:${bCol};border-color:${bCol}44;background:${bCol}11">${s.bias}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
        <td><span style="color:${sCol};font-weight:700;font-size:12px">${pct ? pct+'%' : '—'}</span></td>
        <td style="font-size:12px;color:var(--muted)">${(s.rules_broken||[]).length || '—'}</td>
        <td>${s.reflect_lesson ? '<i class="fa-solid fa-check" style="color:var(--accent2)"></i>' : '<i class="fa-solid fa-xmark" style="color:var(--muted);opacity:.4"></i>'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}
async function saveReflect() {
  if (!currentSession) return;
  try {
    await upsertSession({
      reflect_mood:   currentSession.reflect_mood,
      reflect_well:   document.getElementById('reflectWell').value,
      reflect_wrong:  document.getElementById('reflectWrong').value,
      reflect_lesson: document.getElementById('reflectLesson').value,
      rules_broken:   currentSession.rules_broken || []
    });
    clearDirty('reflect');
    showToast('Reflection saved!', 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Save failed: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}

// ══════════════════════════════════════════════════════════════════════
//  CUSTOMIZE TAB
// ══════════════════════════════════════════════════════════════════════
function renderCustomize() { renderTemplateRow(); renderCzItems(); renderSetupList(); renderFeatureToggles(); renderThresholds(); }
function renderTemplateRow() {
  const el     = document.getElementById('czTemplateRow'); el.innerHTML = '';
  const active = psSettings?.active_template || 'scalping';
  const custom = psSettings?.templates || {};
  Object.entries(FACTORY_TEMPLATES).forEach(([key, t]) => {
    const btn = document.createElement('button');
    btn.className = 'cz-template-btn' + (active === key ? ' active' : '');
    btn.innerHTML = `<i class="${t.icon}"></i> ${esc(t.name)}`;
    btn.addEventListener('click', () => applyTemplate(key, t.items));
    el.appendChild(btn);
  });
  Object.entries(custom).forEach(([key, t]) => {
    const btn = document.createElement('button');
    btn.className = 'cz-template-btn' + (active === key ? ' active' : '');
    btn.innerHTML = `<i class="fa-solid fa-star"></i> ${esc(t.name)} <button class="cz-template-rm" onclick="event.stopPropagation();deleteTemplate('${key}')"><i class="fa-solid fa-xmark"></i></button>`;
    btn.addEventListener('click', (e) => { if (!e.target.closest('.cz-template-rm')) applyTemplate(key, t.items, key); });
    el.appendChild(btn);
  });
  renderTemplateGrid();
}
function renderTemplateGrid() {
  const grid = document.getElementById('templateGrid'); if (!grid) return;
  const active = psSettings?.active_template || 'scalping';
  const custom = psSettings?.templates || {};
  grid.innerHTML = '';
  Object.entries(FACTORY_TEMPLATES).forEach(([key, t]) => {
    const div = document.createElement('div');
    div.className = 'template-opt' + (active === key ? ' active' : '');
    div.innerHTML = `<div class="topt-icon"><i class="${t.icon}"></i></div><div class="topt-name">${esc(t.name)}</div><div class="topt-desc">${esc(t.desc)}</div><div class="topt-count">${t.items.length} items</div>`;
    div.addEventListener('click', () => { applyTemplate(key, t.items); closeTemplateModal(); });
    grid.appendChild(div);
  });
  Object.entries(custom).forEach(([key, t]) => {
    const div = document.createElement('div');
    div.className = 'template-opt' + (active === key ? ' active' : '');
    div.innerHTML = `<button class="topt-rm" onclick="event.stopPropagation();deleteTemplate('${key}')"><i class="fa-solid fa-xmark"></i></button><div class="topt-icon"><i class="fa-solid fa-star"></i></div><div class="topt-name">${esc(t.name)}</div><div class="topt-count">${(t.items||[]).length} items</div>`;
    div.addEventListener('click', (e) => { if (!e.target.closest('.topt-rm')) { applyTemplate(key, t.items, key); closeTemplateModal(); } });
    grid.appendChild(div);
  });
}
async function applyTemplate(key, items, templateKey) {
  if (!confirm(`Apply "${FACTORY_TEMPLATES[key]?.name || key}" template? This replaces your current checklist items.`)) return;
  try {
    await savePsSettings({ checklist_items: items, active_template: templateKey || key });
    renderCzItems(); renderChecklistItems(); updateChecklistScore(); renderTemplateRow();
    showToast('Template applied!', 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Error: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}
async function saveCurrentAsTemplate() {
  const name = document.getElementById('czNewTemplateName').value.trim();
  if (!name) { showToast('Enter a template name first.','fa-solid fa-triangle-exclamation','red'); return; }
  const key = 'user_' + Date.now();
  const templates = { ...(psSettings?.templates || {}), [key]: { name, items: psSettings?.checklist_items || [] } };
  try {
    await savePsSettings({ templates });
    document.getElementById('czNewTemplateName').value = '';
    renderTemplateRow();
    showToast(`Template "${name}" saved!`, 'fa-solid fa-circle-check', 'green');
  } catch(e) { showToast('Error: ' + e.message, 'fa-solid fa-circle-exclamation', 'red'); }
}
async function deleteTemplate(key) {
  if (!confirm('Delete this template?')) return;
  const templates = { ...(psSettings?.templates || {}) }; delete templates[key];
  try { await savePsSettings({ templates }); renderTemplateRow(); showToast('Template deleted.','fa-solid fa-circle-check','green'); }
  catch(e) { showToast('Error: ' + e.message,'fa-solid fa-circle-exclamation','red'); }
}
function openTemplateModal()  { document.getElementById('templateOverlay').classList.add('open'); renderTemplateGrid(); }
function closeTemplateModal() { document.getElementById('templateOverlay').classList.remove('open'); }

function renderCzItems() {
  const items = psSettings?.checklist_items || [];
  const el = document.getElementById('czItemsList'); el.innerHTML = '';
  items.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'cz-item-row'; row.setAttribute('draggable','true'); row.dataset.idx = i;
    const isCrit = (item.weight || 1) >= 2;
    row.innerHTML = `<span class="cz-item-drag"><i class="fa-solid fa-grip-vertical"></i></span><span class="cz-item-text" contenteditable="true" onblur="updateCzItem(${i},this.textContent)">${esc(item.text)}</span><span class="cz-item-cat-badge">${esc(item.cat)}</span><button class="cz-weight-btn${isCrit?' active':''}" onclick="toggleItemWeight(${i})" title="${isCrit?'Critical (double weight)':'Mark as critical'}">★</button><button class="cz-item-rm" onclick="removeCzItem(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    row.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', i));
    row.addEventListener('dragover',  e => e.preventDefault());
    row.addEventListener('drop', async e => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain')), to = parseInt(row.dataset.idx);
      if (from === to) return;
      const arr = [...(psSettings?.checklist_items||[])];
      const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved);
      await savePsSettings({ checklist_items: arr }); renderCzItems(); renderChecklistItems();
    });
    el.appendChild(row);
  });
}
async function toggleItemWeight(i) {
  const items = [...(psSettings?.checklist_items||[])];
  if (!items[i]) return;
  items[i].weight = (items[i].weight || 1) >= 2 ? 1 : 2;
  try { await savePsSettings({ checklist_items: items }); renderCzItems(); renderChecklistItems(); updateChecklistScore(); }
  catch(e) { showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red'); }
}
async function updateCzItem(i, text) {
  const items = [...(psSettings?.checklist_items||[])];
  if (!items[i]) return; items[i].text = text.trim();
  await savePsSettings({ checklist_items: items });
}
async function removeCzItem(i) {
  const items = [...(psSettings?.checklist_items||[])]; items.splice(i,1);
  try { await savePsSettings({ checklist_items: items }); renderCzItems(); renderChecklistItems(); updateChecklistScore(); showToast('Item removed.','fa-solid fa-circle-check','green'); }
  catch(e) { showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red'); }
}
async function addChecklistItem() {
  const text = document.getElementById('czNewItem').value.trim();
  const cat  = document.getElementById('czNewCat').value;
  if (!text) return;
  const items = [...(psSettings?.checklist_items||[])]; items.push({ text, cat });
  try { await savePsSettings({ checklist_items: items }); document.getElementById('czNewItem').value=''; renderCzItems(); renderChecklistItems(); updateChecklistScore(); showToast('Item added!','fa-solid fa-circle-check','green'); }
  catch(e) { showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red'); }
}
function renderSetupList() {
  const setups = psSettings?.setup_library || [];
  const el = document.getElementById('czSetupList'); el.innerHTML = '';
  setups.forEach((s, i) => {
    const tag = document.createElement('div'); tag.className = 'cz-setup-tag';
    tag.innerHTML = `${esc(s)} <button class="cz-setup-rm" onclick="removeSetup(${i})"><i class="fa-solid fa-xmark"></i></button>`;
    el.appendChild(tag);
  });
}
async function addSetup() {
  const val = document.getElementById('czNewSetup').value.trim(); if (!val) return;
  const setups = [...(psSettings?.setup_library||[])];
  if (setups.find(s=>s.toLowerCase()===val.toLowerCase())) { showToast('Setup already exists.','fa-solid fa-triangle-exclamation','red'); return; }
  setups.push(val);
  try { await savePsSettings({ setup_library: setups }); document.getElementById('czNewSetup').value=''; renderSetupList(); showToast('Setup added!','fa-solid fa-circle-check','green'); }
  catch(e) { showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red'); }
}
async function removeSetup(i) {
  const setups = [...(psSettings?.setup_library||[])]; setups.splice(i,1);
  try { await savePsSettings({ setup_library: setups }); renderSetupList(); showToast('Setup removed.','fa-solid fa-circle-check','green'); }
  catch(e) { showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red'); }
}
function renderFeatureToggles() {
  const toggles = psSettings?.feature_toggles || {};
  ['banner','tradeLock','autofill','reflectReminder'].forEach(k => {
    const sw = document.getElementById('toggle_' + k);
    if (sw) sw.classList.toggle('on', !!toggles[k]);
  });
}
function czToggle(key) {
  const sw = document.getElementById('toggle_' + key); if (!sw) return;
  const toggles = { ...(psSettings?.feature_toggles||{}) };
  toggles[key] = !toggles[key]; sw.classList.toggle('on', !!toggles[key]);
  psSettings.feature_toggles = toggles; renderBanner();
}
function renderThresholds() {
  const t = psSettings?.thresholds || { ok:70, good:85 };
  document.getElementById('threshOK').value   = t.ok;
  document.getElementById('threshGood').value = t.good;
  updateThresholds();
}
function updateThresholds() {
  const ok = parseInt(document.getElementById('threshOK').value);
  const good = parseInt(document.getElementById('threshGood').value);
  document.getElementById('threshOKVal').textContent    = ok;
  document.getElementById('threshGoodVal').textContent  = good;
  document.getElementById('threshOKLabel').textContent  = ok - 1;
  document.getElementById('threshOKLabel2').textContent = ok;
  document.getElementById('threshGoodLabel').textContent  = good - 1;
  document.getElementById('threshGoodLabel2').textContent = good;
}
async function saveCustomize() {
  const ok   = parseInt(document.getElementById('threshOK').value);
  const good = parseInt(document.getElementById('threshGood').value);
  try {
    await savePsSettings({ feature_toggles: psSettings?.feature_toggles || {}, thresholds: { ok, good } });
    updateChecklistScore(); renderBanner(); renderIntentLockBar();
    showToast('Settings saved!','fa-solid fa-circle-check','green');
  } catch(e) { showToast('Error: '+e.message,'fa-solid fa-circle-exclamation','red'); }
}
async function reloadJournalSettings() { journalSettings = await getJournalSettings(jid); renderReflectMoods(currentSession?.reflect_mood); }