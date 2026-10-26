/* Card charges: Nick's and Pete's Charges (their cards and rows Kevin hands them) and
   Kevin's Cards review (every card, alerts, duplicates, held items, hand-offs).
   Answers go to charge_answers; the morning export hands them to the bookkeeping tool,
   whose recode preview still waits for Kevin's yes. */
(function () {
  'use strict';
  const A = window.JPL;
  const { esc, num, fmtDate, fmtTime, money, money2, toast, D, titleCase, dot } = A;
  const ui = { tab: null, holder: '', q: '', limit: 60, other: {} };

  const CODE_ACTIONS = ['POST', 'ASK', 'AMAZON'];
  const AUTO = new Set(['TRANSFER', 'MATCH', 'EXCLUDE']);
  const SIMPLE_ACCOUNTS = ['Food Purchases', 'Bar Purchases', 'Restaurant Supplies', 'Merchandise & Grocery -COGS', 'Gasoline Purchases',
    'Repairs and Maintenance', 'Office Supplies', 'Automobile Expense', 'Advertising and Promotion', 'Cabin Rental - Cost of Goods:Cabin Supplies',
    'Meals and Entertainment', 'Travel Expense', 'Computer and Internet Expenses:Software License Fee', 'Telephone Expense',
    'Personal Property', 'Construction in Progress - Golf Course', 'Uncategorized - To Be Coded'];
  const SIMPLE_CLASSES = ['Restaurant & Bar', 'Cabins', 'Campground', 'Camp Store', 'Jackpine9', 'Crooked Lake', 'Overhead'];
  const CLASS_LABELS = { Jackpine9: 'Jackpine9 (golf course)', Overhead: 'Overhead (whole property)' };
  const VEHICLE_RX = /KWIK TRIP|GLADSTONE ECO|CIRCLE ?K|WOODYS OUTPOST|OTSEGO AVE|PAT & GARY|Krist Oil|Shell Oil|Bp#|Sunoco|Eco Fuels|Zephyr Fuel|Rbt|NAPA|LARSONS|CHUCK RENZE|FORD - ACC|PIONEER QUICK|HUSKY LINERS|SEC OF STATE|Garys Collision|AUTO PARTS|Ford Manistique/i;
  const list = (key, d) => { const r = D('lists').find((x) => x.key === key); return r ? r.data : d; };
  const accounts = () => list('accounts', SIMPLE_ACCOUNTS);
  const vehicles = () => list('vehicles', ['F-350 (Nick)', '2015 Chevy (Pete)', '2022 F-150 (Kevin)', 'Bronco (Kevin, leased)', '2011 Chevy plow truck']).concat(['Other / not a vehicle']);
  const capCents = () => num((list('settings', {}) || {}).cap_threshold_cents) || 50000;

  // ------------------------------------------------------------ status, shared with the desk
  let ansIndex = null, ansSrc = null;
  function answers() {
    if (ansSrc !== D('answers')) { ansSrc = D('answers'); ansIndex = {}; ansSrc.forEach((a) => { ansIndex[a.charge_id + '|' + a.who] = a; }); }
    return ansIndex;
  }
  let kevIndex = null, kevSrc = null;
  const kev = () => { if (kevSrc !== D('ckevin')) { kevSrc = D('ckevin'); kevIndex = {}; kevSrc.forEach((r) => { kevIndex[r.charge_id] = r; }); } return kevIndex; };
  // The person who codes a row: whoever it was handed to, else the cardholder (Janet's and shared rows stay with Kevin).
  const responsible = (c) => c.handed_to || (c.holder === 'nick' || c.holder === 'pete' ? c.holder : 'kevin');
  const needsAnswer = (c) => ['ASK', 'CHECK', 'AMAZON'].includes(c.action) || !!c.question;
  // A person's current answer: the newer of what they entered here and what came back from the old pages.
  function answerOf(c, who, kevMap) {
    const a = answers()[c.id + '|' + who] || null;
    const page = who === 'kevin' ? ((kevMap || kev())[c.id] || {}).kevin_answer : (c.holder_answer && responsible(c) === who ? c.holder_answer : null);
    if (!page) return a;
    if (!a) return Object.assign({ from: 'page' }, page);
    return (page.at || '') > (a.updated_at || '') ? Object.assign({ from: 'page' }, page) : a;
  }
  function statusOf(c, who, kevMap) {
    if (c.action === 'POSTED') return 'posted';
    const a = answerOf(c, who, kevMap);
    if (a && (a.status === 'ok' || a.status === 'skip')) return a.status;
    if (AUTO.has(c.action)) return 'auto';
    return needsAnswer(c) ? 'q' : 'open';
  }
  // Rows on a cardholder's screen, counted the way the bookkeeping tool's feed-count counts them.
  const holderRows = (who) => D('charges').filter((c) => (c.holder === who || c.handed_to === who) && (CODE_ACTIONS.includes(c.action) || c.action === 'POSTED'));
  A.chargeCounts = function (who) {
    const rows = holderRows(who).filter((c) => c.action !== 'POSTED');
    const st = rows.map((c) => statusOf(c, who));
    const open = st.filter((s) => s !== 'ok' && s !== 'skip').length;
    return { total: rows.length, open, questions: st.filter((s) => s === 'q').length, done: rows.length - open };
  };

  // ------------------------------------------------------------ one row
  const amt = (c) => money2(Math.abs(num(c.amt_cents) || 0) / 100);
  const short = (d) => (d ? String(d).slice(5).replace('-', '/') : '');
  function codingOf(c, who) {
    const a = answerOf(c, who) || {};
    const d = ui.drafts && ui.drafts[c.id + '|' + who] || {};
    const account = d.account ?? a.account ?? c.account ?? '';
    return { account, cls: d.cls ?? a.cls ?? c.cls ?? '', note: d.note ?? a.note ?? '', vehicle: d.vehicle ?? a.vehicle ?? (VEHICLE_RX.test(c.descr || '') ? defaultVehicle(c) : ''), golf: /^Construction in Progress/i.test(account || '') };
  }
  function defaultVehicle(c) { const v = vehicles(); const w = responsible(c); return w === 'nick' ? v[0] : w === 'pete' ? v[1] : ''; }
  function problem(c, k) {
    if (!k.account) return 'Pick an account first';
    if (!k.cls) return 'Pick a class first';
    if (k.account === 'Uncategorized - To Be Coded' && !k.note) return 'Say what it was in the note';
    if (/^Meals and Entertainment/.test(k.account) && !k.note) return 'Meals need who you were with and why';
    if (/^Personal Property/.test(k.account)) {
      if (Math.abs(num(c.amt_cents) || 0) < capCents()) return 'Under $' + (capCents() / 100).toLocaleString() + ': pick an expense account';
      if (!k.note) return 'Say what it is in the note';
    }
    return '';
  }
  function select(field, id, value, options, label, labels) {
    const opts = !value || options.includes(value) ? options : [value].concat(options);
    return `<select data-f="${field}" data-id="${esc(id)}" aria-label="${esc(label)}">${value ? '' : `<option value="">${esc(label)}…</option>`}${opts.map((o) => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc((labels || {})[o] || o)}</option>`).join('')}${field === 'account' ? '<option value="__other">Other…</option>' : ''}</select>`;
  }
  function rowHtml(c, who, opts) {
    const st = statusOf(c, who); const done = st === 'ok' || st === 'skip'; const k = codingOf(c, who); const key = c.id + '|' + who;
    const owner = who === 'kevin';
    const showAll = ui.other[key];
    const acctOpts = showAll ? accounts() : SIMPLE_ACCOUNTS.filter((a) => owner || a !== 'Construction in Progress - Golf Course');
    const chips = [c.src ? `<span class="chip">${esc(c.src)}</span>` : ''];
    if (opts && opts.kevin) {
      chips.push(`<span class="chip ${c.holder === 'kevin' || !c.holder ? '' : 'info'}">${esc(c.holder ? titleCase(c.holder) : 'Shared')}</span>`);
      if (c.handed_to) chips.push(`<span class="chip acc">to ${esc(titleCase(c.handed_to))}</span>`);
    } else if (c.handed_to === who && c.holder !== who) chips.push('<span class="chip acc">from Kevin</span>');
    if (c.posted_at || c.action === 'POSTED') chips.push('<span class="chip good">posted</span>');
    const lines = [];
    if (c.question) lines.push(`<div class="q">${esc(c.question)}</div>`);
    if (c.tool_note) lines.push(`<div class="meta">${esc(c.tool_note)}</div>`);
    if (c.qbo && c.action !== 'POSTED') lines.push(`<div class="meta">${owner ? `QuickBooks has it as ${esc(c.qbo_coding || 'not coded')} · #${esc(c.qbo)}` : `Already in QuickBooks as ${esc(c.qbo_coding || 'not coded')}. Fix the coding if it's wrong, then tick.`}</div>`);
    if (opts && opts.kevin && opts.held) lines.push(`<div class="meta">${dot('warn')} Held for you: ${esc(opts.held)}</div>`);
    else if (c.held_text && done && !c.posted_at) lines.push(`<div class="meta">${dot('warn')} ${esc(c.held_text)}</div>`);
    let body;
    if (c.action === 'POSTED') body = `<div class="meta">${esc([c.account, c.cls].filter(Boolean).join(' · '))}</div>`;
    else if (opts && opts.readonly) {
      const a = answerOf(c, responsible(c));
      body = `<div class="meta">${st === 'ok' || st === 'skip' || (a && a.status === 'ok') ? '' : 'Waiting on ' + esc(titleCase(responsible(c))) + '. '}${a && a.account ? esc(a.account + (a.cls ? ' · ' + a.cls : '') + (a.note ? ' — ' + a.note : '')) : ''}</div>`;
    } else if (done) {
      const a = answerOf(c, who) || {};
      body = `<div class="acts"><span class="small">${st === 'skip' ? 'Skipped' : esc([a.account, a.cls].filter(Boolean).join(' · ') + (a.note ? ' — ' + a.note : '') + (a.vehicle ? ' · ' + a.vehicle : ''))}</span><button class="sm quiet" data-undo="${esc(c.id)}">Undo</button></div>`;
    } else {
      const vehicleish = VEHICLE_RX.test(c.descr || '') || /^(Automobile|Gasoline)/.test(k.account || '');
      const hint = /^Meals and Entertainment/.test(k.account || '') ? '<div class="hint">Meals: at most half is deductible, entertainment none. Put who you were with and why.</div>'
        : /^Personal Property/.test(k.account || '') ? `<div class="hint">Asset: one item of $${(capCents() / 100).toLocaleString()} or more that lasts over a year. Say what it is.</div>` : '';
      body = `<div class="form">
          ${select('account', c.id, k.account, acctOpts, 'Account')}
          ${select('cls', c.id, k.cls, SIMPLE_CLASSES, 'Class', CLASS_LABELS)}
          <input class="full" data-f="note" data-id="${esc(c.id)}" value="${esc(k.note)}" maxlength="500" placeholder="${c.action === 'AMAZON' ? 'what was ordered, what for' : 'what it was for (optional)'}" aria-label="Note" autocomplete="off">
          ${vehicleish ? `<span class="full">${select('vehicle', c.id, k.vehicle, vehicles(), 'Vehicle')}</span>` : ''}${hint}
        </div>
        <div class="acts"><button class="sm primary" data-ok="${esc(c.id)}">✓ Approve</button><button class="sm" data-skip="${esc(c.id)}">Skip</button><span class="msg" data-msg="${esc(c.id)}"></span></div>`;
    }
    const hand = opts && opts.kevin && opts.canHand ? `<label class="small muted" style="display:inline-flex;gap:6px;align-items:center">Hand to <select data-hand="${esc(c.id)}" style="width:auto;padding:3px 6px;font-size:13px"><option value="">—</option><option value="nick" ${c.handed_to === 'nick' ? 'selected' : ''}>Nick</option><option value="pete" ${c.handed_to === 'pete' ? 'selected' : ''}>Pete</option></select></label>` : '';
    return `<div class="crow ${done ? 'done' : ''}" data-row="${esc(c.id)}">
      <div class="top"><span class="when">${esc(short(c.date))}</span><div class="what"><b>${esc(c.descr || c.payee || '(no description)')}</b><div class="meta">${chips.join('')}${c.payee && c.payee !== c.descr ? `<span>${esc(c.payee)}</span>` : ''}${hand}</div></div><span class="amt ${num(c.amt_cents) > 0 ? 'pos' : ''}">${num(c.amt_cents) > 0 ? '+' : ''}${amt(c)}</span></div>
      ${lines.join('')}${body}</div>`;
  }

  // ------------------------------------------------------------ Nick's / Pete's Charges
  const CH_KEYS = ['charges', 'answers', 'lists'];
  A.titles.charges = 'Card charges';
  A.views.charges = function () {
    if (!A.ensure(CH_KEYS)) return A.loading();
    const who = A.role();
    const rows = holderRows(who);
    const st = {}; rows.forEach((c) => { st[c.id] = statusOf(c, who); });
    const coded = rows.filter((c) => c.action !== 'POSTED');
    const done = coded.filter((c) => st[c.id] === 'ok' || st[c.id] === 'skip'); const pend = coded.filter((c) => !(st[c.id] === 'ok' || st[c.id] === 'skip'));
    const posted = rows.filter((c) => c.action === 'POSTED' || c.posted_at); const held = done.filter((c) => !c.posted_at && c.held_text); const wait = done.filter((c) => !c.posted_at && !c.held_text);
    const tot = (r) => r.length + ' · ' + money(Math.abs(A.sum(r, (c) => c.amt_cents)) / 100);
    const tabs = [['q', 'Needs an answer', pend.filter((c) => st[c.id] === 'q')], ['open', 'Proposed', pend.filter((c) => st[c.id] === 'open')], ['done', 'Done', done], ['posted', 'Posted this year', posted]];
    let tab = ui.tab && tabs.some((x) => x[0] === ui.tab) ? ui.tab : (tabs[0][2].length ? 'q' : 'open');
    const shown = (tabs.find((x) => x[0] === tab) || tabs[0])[2].slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.descr).localeCompare(String(b.descr)));
    const asOf = rows.reduce((m, c) => (c.as_of && c.as_of > m ? c.as_of : m), '');
    return `${A.errorsFor(CH_KEYS)}<h1>Card charges</h1>
      <p class="small muted">${who === 'nick' ? 'Your cards' : 'Your cards'} and the charges Kevin hands you. Pick the account and class, then Approve. Answers save as you go; recodes still wait for Kevin's yes.</p>
      <div class="stats">
        <div class="stat"><span class="l">Still to code</span><span class="v ${pend.length ? 'neg' : ''}">${tot(pend)}</span></div>
        <div class="stat"><span class="l">Answered, waiting to post</span><span class="v">${tot(wait)}</span></div>
        <div class="stat"><span class="l">Held for Kevin</span><span class="v">${tot(held)}</span></div>
        <div class="stat"><span class="l">Posted this year</span><span class="v">${tot(posted)}</span></div>
      </div>
      <div class="toolbar"><div class="tabs" role="tablist">${tabs.map(([k, l, r]) => `<button type="button" role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${esc(l)}<span class="n">${r.length}</span></button>`).join('')}</div></div>
      <section class="card">${shown.length ? shown.slice(0, ui.limit).map((c) => rowHtml(c, who)).join('') : `<div class="empty">${tab === 'q' || tab === 'open' ? 'Nothing waiting here.' : 'None yet.'}</div>`}
      ${shown.length > ui.limit ? `<button class="quiet" data-more>Show ${Math.min(60, shown.length - ui.limit)} more of ${shown.length - ui.limit}</button>` : ''}</section>
      ${tab === 'open' && shown.length > 1 ? '<div class="row" style="margin-top:8px"><button data-okall>Approve all shown</button><span class="small muted" data-okallmsg></span></div>' : ''}
      <p class="tiny muted">${asOf ? 'Rows from the morning run, ' + esc(fmtTime(asOf)) + '. ' : ''}If you're not sure which account, pick "Uncategorized - To Be Coded" and say what it was.</p>`;
  };

  // ------------------------------------------------------------ Kevin's Cards review
  const CR_KEYS = ['charges', 'answers', 'lists', 'ckevin', 'kdocs', 'setup'];
  A.titles.cards = 'Cards review';
  const HOLDERS = [['', 'All'], ['kevin', 'Kevin'], ['shared', 'Shared + checking'], ['janet', 'Janet'], ['nick', 'Nick'], ['pete', 'Pete']];
  A.views.cards = function () {
    if (!A.ensure(CR_KEYS)) return A.loading();
    const km = kev();
    const all = D('charges').filter((c) => c.action !== 'POSTED');
    const statusK = (c) => statusOf(c, responsible(c), km);
    const byHolder = (c) => !ui.holder || (ui.holder === 'shared' ? !c.holder : ui.holder === 'kevin' ? c.holder === 'kevin' : c.holder === ui.holder || c.handed_to === ui.holder);
    const q = ui.q.trim().toLowerCase();
    const match = (c) => !q || [c.descr, c.payee, c.src, c.account, c.tool_note, c.question].join(' ').toLowerCase().includes(q);
    const pool = all.filter(byHolder).filter(match);
    const st = {}; pool.forEach((c) => { st[c.id] = statusK(c); });
    const isDone = (c) => st[c.id] === 'ok' || st[c.id] === 'skip';
    const tabs = [
      ['q', 'Needs an answer', pool.filter((c) => st[c.id] === 'q' && responsible(c) === 'kevin')],
      ['open', 'Proposed', pool.filter((c) => st[c.id] === 'open' && responsible(c) === 'kevin')],
      ['held', 'Held', pool.filter((c) => (km[c.id] || {}).held_reason)],
      ['out', 'With Nick + Pete', pool.filter((c) => responsible(c) !== 'kevin' && !isDone(c) && st[c.id] !== 'auto')],
      ['auto', 'Handled by the tool', pool.filter((c) => st[c.id] === 'auto')],
      ['done', 'Done', pool.filter(isDone)],
      ['all', 'All', pool]
    ];
    const tab = ui.tab && tabs.some((x) => x[0] === ui.tab) ? ui.tab : 'q';
    const shown = (tabs.find((x) => x[0] === tab) || tabs[0])[2].slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.descr).localeCompare(String(b.descr)));
    const alerts = (D('kdocs').find((d) => d.key === 'alerts') || {}).data || {};
    const dups = alerts.duplicates || [], amb = alerts.ambiguous || [];
    const counts = ['nick', 'pete'].map((w) => [w, A.chargeCounts(w)]);
    const kst = all.filter((c) => responsible(c) === 'kevin' && !c.posted_at).map((c) => statusOf(c, 'kevin', km));
    const kevinQ = kst.filter((x) => x === 'q').length, kevinP = kst.filter((x) => x === 'open').length;
    const heldN = Object.values(km).filter((r) => r.held_reason).length;
    return `${A.errorsFor(CR_KEYS)}<h1>Cards review</h1>
      <div class="stats">
        <div class="stat"><span class="l">Yours: need an answer</span><span class="v ${kevinQ ? 'neg' : ''}">${kevinQ}</span><span class="s">${kevinP} more proposed · Kevin, Janet, shared, checking</span></div>
        ${counts.map(([w, c]) => `<div class="stat"><span class="l">${titleCase(w)} to code</span><span class="v">${c.open}</span><span class="s">${c.questions} with a question · ${c.done} done</span></div>`).join('')}
        <div class="stat"><span class="l">Held for you</span><span class="v">${heldN}</span><span class="s">at posting or recode</span></div>
      </div>
      ${dups.length || amb.length ? `<section class="card"><h3>Card alerts</h3>${alertList('Possible double charges', dups, 'crit')}${alertList('Ambiguous matches', amb, 'warn')}<p class="tiny muted">From QuickBooks' own feed, ${esc(fmtTime((D('kdocs').find((d) => d.key === 'alerts') || {}).at))}. Check them in QuickBooks.</p></section>` : ''}
      <div class="toolbar" style="margin-top:12px">
        <div class="row" style="margin-bottom:6px"><div class="seg">${HOLDERS.map(([k, l]) => `<button type="button" class="${ui.holder === k ? 'on' : ''}" data-holder="${k}">${l}</button>`).join('')}</div>
        <input id="crQ" type="search" placeholder="search vendor, note" value="${esc(ui.q)}" style="max-width:240px" aria-label="Search"></div>
        <div class="tabs">${tabs.map(([k, l, r]) => `<button type="button" class="${k === tab ? 'on' : ''}" data-tab="${k}">${esc(l)}<span class="n">${r.length}</span></button>`).join('')}</div>
      </div>
      <section class="card">${shown.length ? shown.slice(0, ui.limit).map((c) => rowHtml(c, 'kevin', { kevin: true, readonly: responsible(c) !== 'kevin', canHand: c.holder !== 'nick' && c.holder !== 'pete' && CODE_ACTIONS.includes(c.action), held: (km[c.id] || {}).held_reason })).join('') : '<div class="empty">Nothing here.</div>'}
      ${shown.length > ui.limit ? `<button class="quiet" data-more>Show ${Math.min(60, shown.length - ui.limit)} more of ${shown.length - ui.limit}</button>` : ''}</section>
      ${tab === 'open' && shown.length > 1 ? '<div class="row" style="margin-top:8px"><button data-okall>Approve all shown</button><span class="small muted" data-okallmsg></span></div>' : ''}
      <details class="card" style="margin-top:12px"><summary><b>Setup notes</b> <span class="small muted">only you see these</span></summary>${setupNotes()}</details>`;
  };
  function alertList(title, rows, lvl) {
    if (!rows.length) return '';
    return `<div style="margin-top:6px"><div class="small">${dot(lvl)} <b>${esc(title)}</b> ${rows.length}</div><ul class="list">${rows.slice(0, 12).map((r) => `<li><span>${esc(fmtDate(r.date))} · ${esc(r.desc || '')}${r.account ? ' <span class="muted">· ' + esc(r.account) + '</span>' : ''}</span><span class="mono">${money2(Math.abs(num(r.amount) || 0))}</span></li>`).join('')}${rows.length > 12 ? `<li class="muted">+${rows.length - 12} more</li>` : ''}</ul></div>`;
  }
  const SETUP = [['cards', 'Cards: whose card is which'], ['checks', 'Paper checks: how to get payee and purpose'], ['feeds', 'Bank feeds to reconnect'], ['extra', 'Anything else for the bookkeeping tool']];
  function setupNotes() {
    const m = {}; D('setup').forEach((r) => { m[r.key] = r.text; });
    return SETUP.map(([k, l]) => `<label class="f" style="margin-top:10px">${esc(l)}<textarea data-setup="${k}" maxlength="2000">${esc(m[k] || '')}</textarea></label>`).join('');
  }

  // ------------------------------------------------------------ wiring (both screens)
  async function saveAnswer(c, who, status) {
    const k = codingOf(c, who);
    const row = { charge_id: c.id, who, status, account: k.account || null, cls: k.cls || null, golf: k.golf, note: k.note || null, vehicle: k.vehicle || null };
    await A.upsert('charge_answers', row, 'charge_id,who', ['answers']);
    if (ui.drafts) delete ui.drafts[c.id + '|' + who];
  }
  function wireRows(root, whoFor) {
    ui.drafts = ui.drafts || {};
    const byId = (id) => D('charges').find((c) => c.id === id);
    const draft = (id) => { const k = id + '|' + whoFor(byId(id)); return ui.drafts[k] || (ui.drafts[k] = {}); };
    let noteTimer = null;
    root.querySelectorAll('[data-f]').forEach((el) => {
      const ev = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        const id = el.dataset.id, f = el.dataset.f, c = byId(id); if (!c) return;
        if (f === 'account' && el.value === '__other') { ui.other[id + '|' + whoFor(c)] = true; A.render(); return; }
        draft(id)[f] = el.value;
        const save = () => saveAnswer(c, whoFor(c), 'edited').catch(() => {});
        if (f === 'note') { clearTimeout(noteTimer); noteTimer = setTimeout(save, 700); } else { save().then(() => A.render()); }
      });
    });
    root.querySelectorAll('[data-ok],[data-skip]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.ok || b.dataset.skip; const c = byId(id); const who = whoFor(c);
      if (b.dataset.ok) { const p = problem(c, codingOf(c, who)); if (p) { const m = root.querySelector(`[data-msg="${CSS.escape(id)}"]`); if (m) m.textContent = p; return; } }
      b.disabled = true;
      try { await saveAnswer(c, who, b.dataset.ok ? 'ok' : 'skip'); toast(b.dataset.ok ? 'Approved' : 'Skipped'); } catch (e) { b.disabled = false; return; }
      A.render();
    }));
    root.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async () => {
      const c = byId(b.dataset.undo); b.disabled = true;
      try { await saveAnswer(c, whoFor(c), 'open'); } catch (e) { return; }
      A.render();
    }));
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; ui.limit = 60; A.render(); }));
    root.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => { ui.limit += 60; A.render(); }));
    const all = root.querySelector('[data-okall]');
    if (all) all.addEventListener('click', async () => {
      const ids = [...root.querySelectorAll('[data-ok]')].map((b) => b.dataset.ok);
      let n = 0; all.disabled = true;
      for (const id of ids) { const c = byId(id); const who = whoFor(c); if (problem(c, codingOf(c, who))) continue; try { await saveAnswer(c, who, 'ok'); n++; } catch (e) { break; } }
      toast(`Approved ${n}` + (n < ids.length ? `; ${ids.length - n} still need an account, class or note` : ''));
      A.render();
    });
  }
  A.wires.charges = function (root) { wireRows(root, () => A.role()); };
  A.wires.cards = function (root) {
    wireRows(root, () => 'kevin');
    root.querySelectorAll('[data-holder]').forEach((b) => b.addEventListener('click', () => { ui.holder = b.dataset.holder; ui.limit = 60; A.render(); }));
    const q = root.querySelector('#crQ');
    if (q) q.addEventListener('input', () => { ui.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { A.render(); const again = document.getElementById('crQ'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 300); });
    root.querySelectorAll('[data-hand]').forEach((s) => s.addEventListener('change', async () => {
      const to = s.value || null;
      try { await A.update('charges', { handed_to: to, handoff_at: new Date().toISOString() }, { id: s.dataset.hand }, ['charges']); toast(to ? 'Handed to ' + titleCase(to) : 'Back with you'); } catch (e) { /* toast */ }
      A.render();
    }));
    root.querySelectorAll('[data-setup]').forEach((t) => t.addEventListener('change', async () => {
      try { await A.upsert('charge_setup_notes', { key: t.dataset.setup, text: t.value }, 'key', ['setup']); toast('Saved'); } catch (e) { /* toast */ }
    }));
  };
  A.charges = { statusOf, answerOf, responsible, holderRows, needsAnswer };
})();
