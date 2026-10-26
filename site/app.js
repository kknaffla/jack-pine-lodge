/* Jack Pine Lodge app: core (helpers, data, sign-in, navigation). No build step.
   Data lives in Supabase; row-level security decides who sees what. The screens
   are in views-desk.js (Nick's desk), views-charges.js (card charges) and
   views-kevin.js (Kevin's Home, Performance, golf, More). */
(function () {
  'use strict';

  const APP_VERSION = '2026.10.26-1'; // keep in sync with the ?v= tags in index.html
  const CFG = window.APP_CONFIG || {};
  const TZ = CFG.TIME_ZONE || 'America/Detroit';
  const $app = document.getElementById('app');
  const $sheet = document.getElementById('sheet');
  const A = window.JPL = { APP_VERSION, CFG, TZ, views: {}, wires: {}, titles: {} };

  // ------------------------------------------------------------ helpers
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const addDays = (iso, n) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const dayDiff = (a, b) => Math.round((new Date(a.slice(0, 10) + 'T12:00:00Z') - new Date(b.slice(0, 10) + 'T12:00:00Z')) / 86400000);
  const weekday = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
  const mondayOf = (iso) => addDays(iso, -((weekday(iso) + 6) % 7));
  const fmtDate = (iso, opts) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, opts || {})) : '');
  const fmtDay = (iso) => fmtDate(iso, { weekday: 'short' });
  // Square timestamps are local wall-clock times ("2026-10-20T11:52:00").
  const fmtStamp = (s) => {
    if (!s) return '';
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(s)); if (!m) return String(s);
    let hh = +m[2]; const ap = hh >= 12 ? 'p' : 'a'; hh = hh % 12 || 12;
    return fmtDay(m[1]) + ' ' + hh + (m[3] === '00' ? '' : ':' + m[3]) + ap;
  };
  const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const ago = (ts) => {
    if (!ts) return '';
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return fmtTime(ts);
  };
  const money = (v) => (v == null ? '—' : (v < 0 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US'));
  const money2 = (v) => (v == null ? '—' : (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const signed = (v) => (v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const hrs = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' h');
  const pct = (a, b) => (a == null || b == null || !b ? null : (a - b) / Math.abs(b) * 100);
  const pctChip = (a, b, label) => { const p = pct(a, b); if (p == null) return `<span class="muted">— vs ${esc(label)}</span>`; return `<span class="${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}%</span> <span class="muted">vs ${esc(label)}</span>`; };
  const sum = (rows, f) => rows.reduce((a, r) => a + (Number(f ? f(r) : r) || 0), 0);
  const groupBy = (rows, f) => rows.reduce((m, r) => { const k = f(r); (m[k] = m[k] || []).push(r); return m; }, {});
  const titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
  const dot = (lvl) => `<span class="dot ${esc(lvl || 'wait')}"></span>`;
  const STALE_HOURS = 26;
  const isStale = (ts) => !ts || (Date.now() - new Date(ts).getTime()) / 3600000 > STALE_HOURS;
  function barStrip(items) {
    const max = Math.max(0, ...items.map((d) => d.v || 0));
    return `<div class="bars" aria-hidden="true">${items.map((d) => `<span class="${(d.v || 0) <= 0 ? 'lo' : ''}" title="${esc(d.label)} ${esc(money2(d.v))}" style="height:${max > 0 ? Math.max(3, Math.round((d.v || 0) / max * 100)) : 3}%"></span>`).join('')}</div>`;
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }
  // Per-device conveniences only (remembered tab, filter). Never data.
  const mem = {};
  const lsGet = (k, d) => { try { const v = localStorage.getItem('jpl.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : d; } };
  const lsSet = (k, v) => { try { localStorage.setItem('jpl.' + k, JSON.stringify(v)); } catch (e) { mem[k] = v; } };
  Object.assign(A, { esc, safeUrl, num, todayISO, addDays, dayDiff, weekday, mondayOf, fmtDate, fmtDay, fmtStamp, fmtTime, ago, money, money2, signed, hrs, pct, pctChip, sum, groupBy, titleCase, dot, isStale, barStrip, toast, lsGet, lsSet });

  // Square categories that are CampLife money or tips (not sales). Nick's database rules hide them.
  A.HIDDEN_CATEGORIES = ['Cabin', 'Campground Fee', 'Kitchen Tips'];
  // Card numbers (last four) by cardholder, as in the bookkeeping tool.
  A.CARDS = { nick: ['1021', '3843'], pete: ['1047', '3861'], kevin: ['1005', '5823'], janet: ['1834', '1853'] };

  // ------------------------------------------------------------ data
  const state = A.state = { session: null, me: null, data: {}, loading: {}, errors: {}, syncStatus: '' };
  let sb = null;
  let channel = null;
  const PAGE = 1000; // PostgREST returns at most 1000 rows per request

  async function pages(build) {
    let out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build().range(from, from + PAGE - 1);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < PAGE) return out;
    }
  }
  async function one(qb) { const { data, error } = await qb; if (error) throw error; return data || []; }
  const t = () => todayISO();
  const LOADERS = {
    members: () => one(sb.from('members').select('*')),
    tasks: () => one(sb.from('tasks').select('*').order('created')),
    attention: () => one(sb.from('attention_items').select('*')),
    briefs: () => one(sb.from('briefs').select('*').order('week_start', { ascending: false }).limit(6)),
    camplife: () => one(sb.from('camplife_days').select('*').order('date', { ascending: false }).limit(7)),
    camplife_bal: () => one(sb.from('camplife_balances').select('*').order('date', { ascending: false }).limit(7)),
    drawers: () => one(sb.from('drawer_shifts').select('*').gte('date', addDays(t(), -45)).order('date', { ascending: false })),
    timecards: () => pages(() => sb.from('timecards').select('*').order('in_at', { ascending: false })),
    fixes: () => one(sb.from('timecard_fixes').select('*').order('created_at', { ascending: false }).limit(300)),
    close: () => one(sb.from('daily_close').select('*').gte('date', addDays(t(), -14))),
    payroll: () => one(sb.from('payroll_asks').select('*').order('period_end', { ascending: false }).limit(26)),
    schedule: () => one(sb.from('schedule_weeks').select('*').gte('week_of', addDays(t(), -21))),
    charges: () => pages(() => sb.from('charges').select('*').eq('active', true).order('date', { ascending: false }).order('id')),
    answers: () => pages(() => sb.from('charge_answers').select('*').order('charge_id')),
    lists: () => one(sb.from('app_lists').select('*')),
    golf: () => one(sb.from('golf_spend').select('*').order('month')),
    kdocs: () => one(sb.from('kevin_docs').select('*')),
    ckevin: () => pages(() => sb.from('charge_kevin').select('*').order('charge_id')),
    setup: () => one(sb.from('charge_setup_notes').select('*')),
    runs: () => one(sb.from('feed_runs').select('*').order('at', { ascending: false }).limit(30)),
    sales_recent: () => pages(() => sb.from('sales_daily').select('day,location,category,net_sales,as_of').gte('day', addDays(t(), -45)).order('day').order('location').order('category')),
    sales: () => pages(() => sb.from('sales_daily').select('day,location,category,net_sales,as_of').order('day').order('location').order('category')),
    items: () => pages(() => sb.from('sales_items_monthly').select('*').order('month').order('category').order('item')),
    cats: () => one(sb.from('sales_categories').select('*').order('sort')),
    hours: () => pages(() => sb.from('payroll_hours').select('*').order('period_end').order('employee'))
  };
  // Which loaded keys a realtime change on a table refreshes.
  const LIVE = { tasks: ['tasks'], charge_answers: ['answers'], timecard_fixes: ['fixes'], schedule_weeks: ['schedule'], payroll_asks: ['payroll'], daily_close: ['close'], charges: ['charges'], feed_runs: ['runs'] };

  async function load(key) {
    if (state.loading[key]) return state.loading[key];
    state.loading[key] = (async () => {
      try { state.data[key] = await LOADERS[key](); delete state.errors[key]; }
      catch (e) { console.error(key, e); state.errors[key] = e.message || String(e); state.data[key] = state.data[key] || []; }
      finally { delete state.loading[key]; }
    })();
    return state.loading[key];
  }
  // A view lists what it needs; anything missing loads, then the page re-renders.
  function ensure(keys) {
    const missing = keys.filter((k) => !(k in state.data));
    if (!missing.length) return true;
    Promise.all(missing.map(load)).then(() => { if (!$sheet.open) render(); });
    return false;
  }
  const D = (k) => state.data[k] || [];
  async function reload(keys) { await Promise.all(keys.filter((k) => k in state.data).map((k) => { delete state.loading[k]; return load(k); })); }
  let reloadTimer = null; const pending = new Set();
  function scheduleReload(keys) {
    keys.forEach((k) => pending.add(k));
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => { const ks = [...pending]; pending.clear(); await reload(ks); if (!$sheet.open && !busyTyping()) render(); }, 300);
  }
  const busyTyping = () => { const a = document.activeElement; return a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('jpl-sync');
    Object.keys(LIVE).forEach((tb) => channel.on('postgres_changes', { event: '*', schema: 'public', table: tb }, () => scheduleReload(LIVE[tb])));
    channel.subscribe((status) => { state.syncStatus = status; if (state.me) chrome(true); });
  }

  // Writes. Each returns the saved rows or throws (with a toast). RLS refusals come back as errors or as 0 rows.
  async function write(qb, refresh) {
    const { data, error } = await qb.select();
    if (error) { toast('Couldn\'t save: ' + error.message); throw error; }
    if (!data || !data.length) { toast('Couldn\'t save: not allowed for this account.'); throw new Error('blocked'); }
    if (refresh && refresh.length) await reload(refresh);
    return data;
  }
  A.db = () => sb;
  A.insert = (table, row, refresh) => write(sb.from(table).insert(row), refresh);
  A.upsert = (table, row, onConflict, refresh) => write(sb.from(table).upsert(row, { onConflict }), refresh);
  A.update = (table, patch, match, refresh) => { let q = sb.from(table).update(patch); Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); }); return write(q, refresh); };
  A.remove = async (table, match, refresh) => {
    let q = sb.from(table).delete(); Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); });
    const { error } = await q; if (error) { toast('Couldn\'t delete: ' + error.message); throw error; }
    if (refresh) await reload(refresh);
  };
  Object.assign(A, { D, ensure, load, reload, pages });

  // ------------------------------------------------------------ roles + navigation
  const ICON = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    desk: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/>',
    card: '<rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M3 10h18M6.5 15h4"/>',
    chart: '<path d="M4 20h16"/><path d="M7 16v-5M12 16V7M17 16v-8"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    pay: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
    flag: '<path d="M7 21V4"/><path d="M7 4.5l10 3.5-10 3.5"/><path d="M4 21h8"/>',
    more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
    pine: '<path d="M12 2.5 7 10h2.5l-3.5 5h2.5L5 20h14l-3.5-5H18l-3.5-5H17z"/><path d="M12 20v2"/>'
  };
  const icon = (k) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  A.icon = icon;
  // Phone tabs per role; desktop adds the second list.
  const NAV = {
    kevin: [['#/', 'Home', 'home'], ['#/today', 'Desk', 'desk'], ['#/cards', 'Cards', 'card'], ['#/performance', 'Performance', 'chart'], ['#/more', 'More', 'more']],
    nick: [['#/', 'Today', 'desk'], ['#/timecards', 'Timecards', 'clock'], ['#/payroll', 'Payroll', 'pay'], ['#/charges', 'Charges', 'card'], ['#/more', 'More', 'more']],
    pete: [['#/', 'Charges', 'card'], ['#/golf', 'Golf', 'flag'], ['#/more', 'More', 'more']]
  };
  const EXTRA = {
    kevin: [['#/timecards', 'Timecards', 'clock'], ['#/payroll', 'Payroll', 'pay'], ['#/golf', 'Golf', 'flag']],
    nick: [['#/performance', 'Performance', 'chart'], ['#/golf', 'Golf', 'flag']],
    pete: []
  };
  const HOME = { kevin: 'home', nick: 'today', pete: 'charges' };
  // Which roles may open a page. The database decides what data each one gets.
  const ACCESS = {
    home: ['kevin'], today: ['kevin', 'nick'], timecards: ['kevin', 'nick'], payroll: ['kevin', 'nick'],
    charges: ['nick', 'pete'], cards: ['kevin'], performance: ['kevin', 'nick'], golf: ['kevin', 'nick', 'pete'],
    more: ['kevin', 'nick', 'pete'], backup: ['kevin']
  };
  const role = () => (state.me && state.me.role) || '';
  A.role = role;
  function route() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [page, ...rest] = h.split('/');
    const r = role();
    const p = page || HOME[r];
    return { page: (ACCESS[p] || []).includes(r) ? p : HOME[r], arg: rest.join('/') };
  }
  A.route = route;

  function chrome(show) {
    const top = document.getElementById('topbar'); const tab = document.getElementById('tabbar');
    top.hidden = !show; tab.hidden = !show;
    if (!show) return;
    const r = role(); const cur = route().page;
    const hrefPage = (href) => href.replace(/^#\/?/, '') || HOME[r];
    const live = state.syncStatus === 'SUBSCRIBED', off = ['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state.syncStatus);
    const links = (list) => list.map(([href, l, ic]) => { const on = hrefPage(href) === cur; return `<a href="${href}" class="${on ? 'on' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`; }).join('');
    top.innerHTML = `
      <a href="#/" class="brand">${icon('pine')}<span>Jack Pine Lodge</span></a>
      <span class="pagetitle">${esc(A.titles[cur] || '')}</span>
      <nav class="topnav" aria-label="Main">${links(NAV[r].slice(0, -1).concat(EXTRA[r], [NAV[r][NAV[r].length - 1]]))}</nav>
      <span class="tb-right"><span class="syncwrap ${live ? 'live' : off ? 'off' : ''}" title="${live ? 'Live: changes show on every device' : off ? 'Offline: reconnecting' : 'Connecting'}"><span class="sync"></span><span>${live ? 'Live' : off ? 'Offline' : '…'}</span></span></span>`;
    tab.innerHTML = links(NAV[r]);
  }

  // ------------------------------------------------------------ sheet (dialogs)
  A.openSheet = function (html, onOpen) {
    $sheet.innerHTML = html;
    if (!$sheet.open) { if ($sheet.showModal) $sheet.showModal(); else $sheet.setAttribute('open', ''); }
    $sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', A.closeSheet));
    if (onOpen) onOpen($sheet);
  };
  A.closeSheet = function () { if ($sheet.close) $sheet.close(); else $sheet.removeAttribute('open'); $sheet.innerHTML = ''; render(); };
  $sheet.addEventListener('cancel', () => setTimeout(render, 0));

  // ------------------------------------------------------------ render
  A.loading = () => '<p class="muted center pad">Loading…</p>';
  A.errorsFor = (keys) => { const e = keys.filter((k) => state.errors[k]); return e.length ? `<div class="alert bad">Couldn't load ${esc(e.join(', '))}: ${esc(state.errors[e[0]])}</div>` : ''; };
  function render() {
    if (!state.session) return viewLogin();
    if (!state.me) {
      if (!('members' in state.data)) return;
      chrome(false);
      $app.innerHTML = `<div class="login card"><h1>Almost there</h1>
        <p>You're signed in as <b>${esc(state.session.user.email)}</b>, but this account hasn't been added to Jack Pine Lodge yet.</p>
        <p class="small muted">Ask Kevin to add you, then reload.</p><button id="signOut">Sign out</button></div>`;
      document.getElementById('signOut').onclick = signOut;
      return;
    }
    if (role() === 'feed') {
      chrome(false);
      $app.innerHTML = '<div class="login card"><h1>Morning feed account</h1><p class="small">This login is for the script on Kevin\'s Mac. It has no screens.</p><button id="signOut">Sign out</button></div>';
      document.getElementById('signOut').onclick = signOut;
      return;
    }
    const { page, arg } = route();
    chrome(true);
    const view = A.views[page];
    const scroll = window.scrollY;
    $app.innerHTML = view ? view(arg) : '<p class="muted pad">Not found.</p>';
    if (render._last === page) window.scrollTo(0, scroll); else window.scrollTo(0, 0);
    render._last = page;
    if (A.wires[page]) A.wires[page]($app, arg);
  }
  A.render = render;

  // ------------------------------------------------------------ appearance (per device)
  A.currentTheme = () => lsGet('theme', 'auto');
  A.applyTheme = (th) => {
    try { if (th === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', th); } catch (e) { /* private mode */ }
    lsSet('theme', th);
    if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
  };

  // ------------------------------------------------------------ sign-in
  function viewLogin(mode) {
    chrome(false);
    if (mode === 'recover') {
      $app.innerHTML = `<form class="login card" id="pwForm"><h1>Set a new password</h1>
        <label class="f">New password<input type="password" name="pw" minlength="10" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Save password</button></form>`;
      document.getElementById('pwForm').onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await sb.auth.updateUser({ password: e.target.pw.value });
        if (error) toast(error.message); else { toast('Password saved'); location.hash = '#/'; start(); }
      };
      return;
    }
    $app.innerHTML = `<form class="login card" id="loginForm">
      <h1>${icon('pine')} Jack Pine Lodge</h1>
      <p class="muted small">Accounts are made by Kevin.</p>
      <div id="loginMsg"></div>
      <label class="f">Email<input type="email" name="email" required autocomplete="username"></label>
      <label class="f">Password<input type="password" name="pw" required autocomplete="current-password"></label>
      <div class="spread"><button class="primary" type="submit">Sign in</button><button type="button" class="quiet" id="forgot">Forgot password?</button></div>
    </form>`;
    const form = document.getElementById('loginForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.pw.value });
      btn.disabled = false;
      if (error) document.getElementById('loginMsg').innerHTML = `<div class="alert bad">${esc(error.message)}</div>`;
    };
    document.getElementById('forgot').onclick = async () => {
      const email = form.email.value.trim();
      if (!email) { document.getElementById('loginMsg').innerHTML = '<div class="alert">Type your email first, then tap Forgot password.</div>'; return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      document.getElementById('loginMsg').innerHTML = error ? `<div class="alert bad">${esc(error.message)}</div>` : '<div class="alert">If that email has an account, a reset link is on its way.</div>';
    };
  }

  async function signOut() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    await sb.auth.signOut();
  }
  A.signOut = signOut;

  async function start() {
    state.data = {}; state.errors = {};
    await load('members');
    if (state.errors.members) {
      $app.innerHTML = `<div class="login card"><h1>Can't load</h1><p class="small">${esc(state.errors.members)}</p><button id="retry" class="primary">Try again</button> <button id="signOut">Sign out</button></div>`;
      document.getElementById('retry').onclick = start;
      document.getElementById('signOut').onclick = signOut;
      return;
    }
    state.me = D('members').find((m) => m.user_id === state.session.user.id) || null;
    if (state.me && role() !== 'feed') subscribe();
    render();
  }

  A.boot = function () {
    if (!window.supabase || !CFG.SUPABASE_URL || /YOUR-PROJECT/.test(CFG.SUPABASE_URL)) {
      $app.innerHTML = '<div class="login card"><h1>Setup needed</h1><p>Fill in <code>config.js</code> with the Supabase URL and publishable key (README step 3).</p></div>';
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    let recovering = false;
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { recovering = true; state.session = session; viewLogin('recover'); return; }
      const prev = state.session && state.session.user.id;
      state.session = session;
      if (!session) { state.me = null; state.data = {}; viewLogin(); return; }
      if (recovering) return;
      if (event === 'SIGNED_IN' && prev === session.user.id && state.me) return; // token refresh / tab refocus
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
      setTimeout(start, 0);
    });
    window.addEventListener('hashchange', render);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.me) scheduleReload(Object.keys(state.data).filter((k) => k !== 'members')); });
  };
})();
