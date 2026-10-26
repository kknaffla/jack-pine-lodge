/* Nick's desk: Today, Timecards (with Fix and next week's schedule), Payroll ask.
   Modeled on the claude.ai desk page. Kevin can open every screen here too. */
(function () {
  'use strict';
  const A = window.JPL;
  const { esc, num, todayISO, addDays, dayDiff, mondayOf, fmtDate, fmtDay, fmtStamp, fmtTime, ago, money, money2, signed, hrs, pctChip, sum, dot, isStale, barStrip, toast, D } = A;
  const ui = { drill: null, showAll: false, fixOpen: null, cardsAll: false, schedWeek: null, cellOpen: null, payEdit: false, payForm: {}, payBusy: false, photoUrl: {} };

  // ------------------------------------------------------------ shared reads
  const yday = () => addDays(todayISO(), -1);
  const stamp = (s) => (s ? new Date(String(s).replace(' ', 'T')).getTime() : NaN); // local wall-clock
  // Daily net sales as on the desk: Square lines without CampLife money and tips.
  function salesDays() {
    const by = {};
    D('sales_recent').forEach((r) => { if (A.HIDDEN_CATEGORIES.includes(r.category)) return; by[r.day] = (by[r.day] || 0) + Number(r.net_sales); });
    return Object.keys(by).sort().filter((d) => d <= yday()).map((d) => ({ day: d, net: Math.round(by[d] * 100) / 100 }));
  }
  const salesAsOf = () => D('sales_recent').reduce((m, r) => (r.as_of && r.as_of > m ? r.as_of : m), '');
  const sumDays = (days, from, to) => sum(days.filter((d) => d.day >= from && d.day <= to), (d) => d.net);
  function lastClose() { return D('drawers').filter((x) => x.state === 'CLOSED').sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))[0] || null; }
  const osDot = (v) => (v == null ? 'wait' : Math.abs(v) >= 25 ? 'crit' : Math.abs(v) >= 5 ? 'warn' : 'good');
  const osText = (v) => (v == null ? '' : Math.abs(v) < 0.005 ? 'even' : (v > 0 ? 'over ' : 'short ') + money2(Math.abs(v)));
  // Why a timecard looks wrong: auto clock-out, a shift of 14 h or more, or left open 16 h+.
  function cardWhy(c) {
    if (c.auto) return 'auto clock-out';
    if (c.out_at && Number(c.hours) >= 14) return Number(c.hours).toFixed(1) + ' h shift';
    if (!c.out_at && (Date.now() - stamp(c.in_at)) / 3600000 >= 16) return 'left open';
    return '';
  }
  function fixFor(c) { return D('fixes').find((f) => f.status !== 'rejected' && ((c.shift_id && f.shift_id === c.shift_id) || (f.name === c.name && String(f.in_at).slice(0, 16) === String(c.in_at).slice(0, 16)))) || null; }
  const oddCards = () => D('timecards').filter(cardWhy);
  const toFix = () => oddCards().filter((c) => !fixFor(c));
  function weekHours(monday) {
    const by = {};
    D('timecards').forEach((c) => {
      if (String(c.in_at).slice(0, 10) < monday) return;
      const p = by[c.name] || (by[c.name] = { name: c.name, job: c.job, hours: 0, open: false });
      if (c.out_at && c.hours != null) p.hours += Number(c.hours); else if (!c.out_at) p.open = true;
      if (!p.job && c.job) p.job = c.job;
    });
    return Object.values(by).sort((a, b) => b.hours - a.hours);
  }
  // Nick's own tasks (Kevin on the desk sees the ones assigned to Nick).
  const deskTasks = () => D('tasks').filter((t) => t.who === 'nick');
  const closeToday = () => D('close').find((c) => c.date === todayISO()) || null;
  const CLOSE = [{ key: 'drawer', text: 'Drawer counted' }, { key: 'cards', text: 'Timecards checked' }, { key: 'scans', text: 'Invoices scanned' }, { key: 'tips', text: 'Tips declared' }];

  // ------------------------------------------------------------ payroll periods
  // Pay periods end every other Sunday; payroll runs that Thursday or Friday. The ask shows from the
  // Thursday after a period ends until Nick sends it. The app's first period is CFG.PAY_FIRST_END.
  const PAY_FIRST_END = A.CFG.PAY_FIRST_END || '2026-11-08';
  const PAY_ASK_AFTER = 4;
  function payPeriods(today) {
    today = today || todayISO();
    const n = Math.floor((dayDiff(today, PAY_FIRST_END) - PAY_ASK_AFTER) / 14);
    const p = (k) => { const end = addDays(PAY_FIRST_END, 14 * k); return { end, start: addDays(end, -13), ask: addDays(end, PAY_ASK_AFTER) }; };
    return { cur: n >= 0 ? p(n) : null, next: p(Math.max(n + 1, 0)) };
  }
  const payDoc = (end) => D('payroll').find((p) => p.period_end === end) || null;
  function payDue() { const cur = payPeriods().cur; return !!(cur && !(payDoc(cur.end) || {}).sent_at); }
  A.payPeriods = payPeriods; A.payDoc = payDoc; A.payDue = payDue;
  A.desk = { salesDays, lastClose, cardWhy, fixFor, toFix, oddCards, deskTasks, weekHours, osText, osDot };

  // ------------------------------------------------------------ Today
  const TODAY_KEYS = ['drawers', 'sales_recent', 'timecards', 'fixes', 'tasks', 'camplife', 'close', 'attention', 'briefs', 'payroll', 'charges', 'answers'];
  A.titles.today = 'Today';
  A.views.today = function () {
    if (!A.ensure(TODAY_KEYS)) return A.loading();
    const days = salesDays(); const ys = (days.find((d) => d.day === yday()) || {}).net;
    const last = lastClose(); const fixes = toFix(); const open = deskTasks().filter((t) => t.status !== 'done');
    const ch = A.chargeCounts ? A.chargeCounts('nick') : { open: 0, questions: 0 };
    const tcAt = D('timecards').reduce((m, c) => (c.as_of && c.as_of > m ? c.as_of : m), '');
    const drAt = D('drawers').reduce((m, c) => (c.as_of && c.as_of > m ? c.as_of : m), '');
    const tiles = [
      ['cash', 'Cash drawer', last ? money2(num(last.counted)) : '—', last ? `${fmtDate(last.date)} · ${osText(num(last.over_short))}` : 'no close yet', last && Math.abs(num(last.over_short) || 0) >= 25, drAt],
      ['sales', 'Yesterday\'s sales', ys == null ? '—' : money(ys), ys == null ? 'not in yet' : fmtDay(yday()), false, salesAsOf()],
      ['time', 'Timecards', String(fixes.length), fixes.length ? 'to fix' : 'clean', fixes.length > 0, tcAt],
      ['tasks', 'My tasks', String(open.length), 'open', false, null],
      ['charges', 'Card charges', String(ch.open), ch.questions ? ch.questions + ' with a question' : 'to code', ch.open > 0, null]
    ];
    const tileHtml = tiles.map(([k, l, v, s, bad, at]) => `<button type="button" class="tile ${ui.drill === k ? 'on' : ''} ${at && isStale(at) ? 'stale' : ''}" data-tile="${k}"><span class="l">${esc(l)}</span><span class="v ${bad ? 'neg' : ''}">${esc(v)}</span><span class="s">${esc(s)}</span></button>`).join('');
    return `${A.errorsFor(TODAY_KEYS)}
      <div class="spread"><h1>${esc(fmtDate(todayISO(), { weekday: 'long', month: 'long', day: 'numeric' }))}</h1></div>
      <div class="attn">${attentionLine(days)}</div>
      <div class="tiles">${tileHtml}</div>
      ${ui.drill ? `<div class="card drill">${drill(days)}</div>` : ''}
      <div class="grid2" style="margin-top:12px">
        <section class="card"><h3>Labor this week <span class="muted small">from ${esc(fmtDate(mondayOf(todayISO())))}</span></h3>${laborCard()}</section>
        <section class="card"><h3>CampLife <span class="muted small">${esc(fmtDate((D('camplife')[0] || {}).date))}</span></h3>${campCard()}</section>
      </div>
      <div class="grid2" style="margin-top:12px">
        <section class="card" id="tasksCard"><h3>Tasks <span class="muted small">${open.length ? open.length + ' open' : 'none open'}</span></h3>${tasksCard()}</section>
        <section class="card"><h3>Daily close <span class="muted small">${esc(fmtDay(todayISO()))}</span></h3>${closeCard()}</section>
      </div>
      <section class="card" style="margin-top:12px">${briefCard(D('briefs').find((b) => b.audience === 'gm'))}</section>`;
  };

  function attentionLine(days) {
    const items = [];
    const add = (lvl, text, href) => items.push({ lvl, html: `${dot(lvl)}${esc(text)}`, href });
    const odd = toFix().length;
    add(odd ? 'crit' : 'good', odd ? odd + (odd === 1 ? ' timecard to fix' : ' timecards to fix') : 'timecards clean', '#/timecards');
    const last = lastClose(); if (last) { const v = num(last.over_short) || 0; add(osDot(v), 'drawer ' + osText(v) + ' ' + fmtDate(last.date)); }
    const over = weekHours(mondayOf(todayISO())).filter((p) => p.hours >= 40); if (over.length) add('crit', 'over 40 h: ' + over.map((p) => p.name).join(', '));
    const ch = A.chargeCounts ? A.chargeCounts('nick') : { open: 0 }; if (ch.open) add('warn', ch.open + (ch.open === 1 ? ' card charge to code' : ' card charges to code'), '#/charges');
    if (payDue()) add('crit', 'Payroll: Angel\'s hours + Jeff\'s board, through ' + fmtDate(payPeriods().cur.end), '#/payroll');
    const open = deskTasks().filter((t) => t.status !== 'done').length; add(open ? 'warn' : 'good', open ? open + (open === 1 ? ' task open' : ' tasks open') : 'no tasks open');
    const ci = (closeToday() || {}).items || {}; const left = CLOSE.filter((it) => !(ci[it.key] && ci[it.key].done)).length;
    add(left ? 'wait' : 'good', left ? left + (left === 1 ? ' close step left' : ' close steps left') : 'day closed');
    const att = D('attention').filter((a) => a.audience === 'nick');
    const at = att.reduce((m, a) => (a.as_of && a.as_of > m ? a.as_of : m), '');
    if (isStale(at || D('timecards').reduce((m, c) => (c.as_of && c.as_of > m ? c.as_of : m), ''))) add('warn', 'morning update is late, tell Kevin');
    att.forEach((a) => add(a.level, (a.count != null && /^[a-z]/.test(a.label) ? a.count + ' ' : '') + a.label, a.link === 'charges' ? '#/charges' : null));
    const rank = { crit: 0, warn: 1, wait: 2, good: 3 };
    return items.sort((a, b) => rank[a.lvl] - rank[b.lvl]).map((i) => (i.href ? `<a class="a" href="${i.href}">${i.html}</a>` : `<span class="a">${i.html}</span>`)).join('');
  }

  function drill(days) {
    if (ui.drill === 'cash') {
      const shifts = D('drawers').slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id)).filter((x) => x.date >= addDays(todayISO(), -31));
      if (!shifts.length) return '<div class="empty">No drawer shifts yet.</div>';
      const closed = shifts.filter((x) => x.state === 'CLOSED'); const last = lastClose();
      const rows = ui.showAll ? shifts : shifts.slice(0, 10);
      const byDay = {}; shifts.slice().reverse().forEach((x) => { byDay[x.date] = (byDay[x.date] || 0) + (num(x.cash_in) || 0); });
      return `<div class="spread"><h3>Cash drawer</h3><button class="quiet sm" data-drill-close>Close</button></div>
        <div class="stats">
          <div class="stat"><span class="l">Last close</span><span class="v">${last ? money2(num(last.counted)) : '—'}</span><span class="s">${last ? esc(fmtDate(last.date) + (last.closed_by ? ' · ' + last.closed_by : '')) : ''}</span><span class="s">${last ? dot(osDot(num(last.over_short))) + ' ' + esc(osText(num(last.over_short))) : ''}</span></div>
          <div class="stat"><span class="l">Cash taken, 30 days</span><span class="v">${money(sum(shifts, (x) => x.cash_in))}</span></div>
          <div class="stat"><span class="l">Paid out, 30 days</span><span class="v">${money(sum(shifts, (x) => x.paid_out))}</span><span class="s">${closed.length} closes</span></div>
          <div class="stat"><span class="l">Over/short, 30 days</span><span class="v ${Math.abs(sum(closed, (x) => x.over_short)) >= 25 ? 'neg' : ''}">${signed(sum(closed, (x) => x.over_short))}</span></div>
        </div>
        ${barStrip(Object.keys(byDay).sort().map((d) => ({ label: fmtDate(d), v: byDay[d] })))}
        <div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Date</th><th class="txt">Closed by</th><th>Start</th><th>Cash in</th><th>Paid out</th><th>Expected</th><th>Counted</th><th>Over/short</th></tr></thead><tbody>
        ${rows.map((x) => { const open = x.state !== 'CLOSED'; return `<tr><td class="txt">${esc(fmtDay(x.date))}</td><td class="txt">${esc(open ? (x.state === 'ENDED' ? 'ended, not counted' : 'open') : x.closed_by || '—')}</td><td>${money2(num(x.start_cash))}</td><td>${money2(num(x.cash_in))}</td><td>${money2(num(x.paid_out))}</td><td>${money2(num(x.expected))}</td><td>${open ? '—' : money2(num(x.counted))}</td><td>${open ? '—' : dot(osDot(num(x.over_short))) + ' ' + esc(signed(num(x.over_short)))}</td></tr>`; }).join('')}
        </tbody></table></div>
        ${shifts.length > 10 ? `<button class="quiet sm" data-showall>${ui.showAll ? 'Fewer' : 'All ' + shifts.length}</button>` : ''}`;
    }
    if (ui.drill === 'sales') {
      if (!days.length) return '<div class="empty">No daily sales yet.</div>';
      const y = yday(); const ys = (days.find((d) => d.day === y) || {}).net;
      const last7 = sumDays(days, addDays(y, -6), y), prior7 = sumDays(days, addDays(y, -13), addDays(y, -7));
      const last30 = days.slice(-30); const best = days.reduce((b, d) => (!b || d.net > b.net ? d : b), null);
      const rows = (ui.showAll ? days : days.slice(-7)).slice().reverse();
      return `<div class="spread"><h3>Sales</h3><button class="quiet sm" data-drill-close>Close</button></div>
        <div class="stats">
          <div class="stat"><span class="l">Yesterday</span><span class="v">${ys == null ? '—' : money2(ys)}</span><span class="s">${esc(fmtDay(y))}</span></div>
          <div class="stat"><span class="l">Last 7 days</span><span class="v">${money(last7)}</span><span class="s">${pctChip(last7, prior7, 'prior 7')}</span></div>
          <div class="stat"><span class="l">Last 30 days</span><span class="v">${money(sum(last30, (d) => d.net))}</span><span class="s">avg ${money(sum(last30, (d) => d.net) / Math.max(1, last30.length))} a day</span></div>
          <div class="stat"><span class="l">Best day</span><span class="v">${best ? money(best.net) : '—'}</span><span class="s">${best ? esc(fmtDay(best.day)) : ''}</span></div>
        </div>
        ${barStrip(last30.map((d) => ({ label: fmtDate(d.day), v: d.net })))}
        <div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Day</th><th>Net sales</th></tr></thead><tbody>
        ${rows.map((d) => `<tr><td class="txt">${esc(fmtDay(d.day))}</td><td>${money2(d.net)}</td></tr>`).join('')}</tbody></table></div>
        ${days.length > 7 ? `<button class="quiet sm" data-showall>${ui.showAll ? 'Fewer' : 'All ' + days.length}</button>` : ''}
        <p class="small muted">Square sales lines only. Cabin and campground rent (CampLife) and tips left out. Before tax.</p>`;
    }
    return '';
  }

  function laborCard() {
    const people = weekHours(mondayOf(todayISO()));
    if (!people.length) return '<div class="empty">No timecards this week yet.</div>';
    const total = sum(people, (p) => p.hours); const over = people.filter((p) => p.hours >= 40).length, near = people.filter((p) => p.hours >= 32 && p.hours < 40).length;
    return `<div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="l">Hours so far</span><span class="v">${hrs(total)}</span><span class="s">${people.length} ${people.length === 1 ? 'person' : 'people'}</span></div>
        <div class="stat"><span class="l">Past or near 40</span><span class="v ${over ? 'neg' : ''}">${over + near}</span><span class="s">${over ? over + ' over, ' + near + ' near' : near ? near + ' near 40' : 'nobody'}</span></div></div>
      <div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Who</th><th class="txt">Job</th><th>Hours</th><th class="txt"></th></tr></thead><tbody>
      ${people.map((p) => { const cls = p.hours >= 40 ? 'crit' : p.hours >= 32 ? 'warn' : 'good'; const lbl = p.hours >= 40 ? 'over 40' : p.hours >= 32 ? 'near 40' : p.open ? 'clocked in' : ''; return `<tr><td class="txt">${esc(p.name)}</td><td class="txt">${esc(p.job || '')}</td><td>${p.hours.toFixed(1)}</td><td class="txt">${dot(cls)} ${esc(lbl)}</td></tr>`; }).join('')}
      </tbody></table></div><p class="tiny muted">Closed cards only. Hours, never pay.</p>`;
  }

  function campCard() {
    const c = D('camplife')[0];
    if (!c) return '<div class="empty">No CampLife report yet.</div>';
    const arr = c.arrivals || [], dep = c.departures || [], owe = c.owing || [];
    const list = (rows, f) => `<ul class="list">${rows.slice(0, 8).map((g) => `<li><span>${esc(g.name || 'Guest')}</span><span class="muted">${esc(f(g))}</span></li>`).join('')}${rows.length > 8 ? `<li class="muted">+${rows.length - 8} more</li>` : ''}</ul>`;
    return `<div class="cl">
      <div class="stat"><span class="l">Check-ins</span><span class="v">${arr.length}</span>${list(arr, (g) => (g.site ? 'site ' + g.site : g.nights ? g.nights + ' nights' : ''))}</div>
      <div class="stat"><span class="l">Check-outs</span><span class="v">${dep.length}</span>${list(dep, (g) => (g.site ? 'site ' + g.site : ''))}</div>
      <div class="stat"><span class="l">Owe money</span><span class="v ${owe.length ? 'neg' : ''}">${owe.length ? money(sum(owe, (g) => g.amount)) : '0'}</span>${list(owe, (g) => (num(g.amount) != null ? money2(num(g.amount)) : ''))}</div>
    </div>${c.note ? `<p class="tiny muted">${esc(c.note)}</p>` : ''}`;
  }

  function tasksCard() {
    const tasks = deskTasks(); const open = tasks.filter((t) => t.status !== 'done'); const done = tasks.filter((t) => t.status === 'done');
    const list = ui.showDone ? open.concat(done) : open;
    const row = (t) => `<div class="task ${t.status === 'done' ? 'done' : ''}"><button type="button" class="chk ${t.status === 'done' ? 'done' : ''}" data-task="${esc(t.id)}" aria-label="${t.status === 'done' ? 'Reopen' : 'Mark done'}"></button>
      <div class="body"><div class="t">${esc(t.title)}</div>${t.detail || (t.status === 'done' && t.done_at) ? `<div class="d">${esc([t.detail, t.status === 'done' && t.done_at ? 'done ' + fmtDate(t.done_at.slice(0, 10)) : ''].filter(Boolean).join(' · '))}</div>` : ''}</div></div>`;
    return `${list.length ? list.map(row).join('') : `<div class="empty">${tasks.length ? 'All done.' : 'Nothing open.'}</div>`}
      ${done.length ? `<button class="quiet sm" data-showdone>${ui.showDone ? 'Hide done' : 'Show done (' + done.length + ')'}</button>` : ''}
      <form class="row" id="addTask" style="margin-top:8px"><input name="title" maxlength="200" placeholder="Add a task" aria-label="New task" style="flex:1"><button class="primary" type="submit">Add</button></form>`;
  }

  function closeCard() {
    const doc = closeToday() || {}; const items = doc.items || {};
    return `${CLOSE.map((it) => { const d = items[it.key] || {}; return `<div class="closeitem"><button type="button" class="chk ${d.done ? 'done' : ''}" data-close-item="${it.key}" aria-label="${d.done ? 'Unmark ' : 'Mark '}${esc(it.text)}"></button><span>${esc(it.text)}</span><span class="st">${d.done && d.at ? esc(fmtTime(d.at)) : ''}</span></div>`; }).join('')}
      <label class="f" style="margin-top:8px">Drawer note (over/short, anything odd)<input id="drawerNote" maxlength="300" value="${esc(doc.drawer_note || '')}"></label>`;
  }

  function briefCard(b) {
    if (!b) return '<h3>Monday brief</h3><div class="empty">No brief yet. The first one lands Monday at 7:00.</div>';
    const d = b.data || {}; const s = d.sales || {}; const l = d.labor || {}; const off = d.off_pattern || [];
    const days = (s.by_day || []).slice(0, 7);
    return `<div class="spread"><h3>Monday brief</h3><span class="chip">week of ${esc(fmtDate(d.week_start || b.week_start))}${d.week_end ? ' – ' + esc(fmtDate(d.week_end)) : ''}</span></div>
      ${d.summary_gm || d.summary ? `<p class="lead small">${esc(d.summary_gm || d.summary)}</p>` : ''}
      <div class="stats" style="grid-template-columns:repeat(2,minmax(0,1fr))">
        <div class="stat"><span class="l">Sales last week</span><span class="v">${money(num(s.this_week))}</span><span class="s">${pctChip(num(s.this_week), num(s.last_week), 'week before')}</span><span class="s">${pctChip(num(s.this_week), num(s.same_week_last_year), 'last year')}</span>${days.length ? barStrip(days.map((x) => ({ label: fmtDate(x.day), v: num(x.net_sales) || 0 }))) : ''}</div>
        <div class="stat"><span class="l">Labor last week</span><span class="v">${hrs(num(l.hours))}</span>${(l.flags || []).map((f) => `<span class="s">${dot('warn')} ${esc(f)}</span>`).join('') || '<span class="s">no flags</span>'}</div>
      </div>
      ${off.length ? `<ul class="offlist">${off.map((x) => `<li>${dot('warn')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}`;
  }
  A.briefCard = briefCard;

  A.wires.today = function (root) {
    root.querySelectorAll('[data-tile]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.tile;
      if (k === 'time') { location.hash = '#/timecards'; return; }
      if (k === 'charges') { location.hash = A.role() === 'kevin' ? '#/cards' : '#/charges'; return; }
      if (k === 'tasks') { document.getElementById('tasksCard').scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
      ui.drill = ui.drill === k ? null : k; ui.showAll = false; A.render();
    }));
    root.querySelectorAll('[data-drill-close]').forEach((b) => b.addEventListener('click', () => { ui.drill = null; A.render(); }));
    root.querySelectorAll('[data-showall]').forEach((b) => b.addEventListener('click', () => { ui.showAll = !ui.showAll; A.render(); }));
    root.querySelectorAll('[data-showdone]').forEach((b) => b.addEventListener('click', () => { ui.showDone = !ui.showDone; A.render(); }));
    root.querySelectorAll('[data-task]').forEach((b) => b.addEventListener('click', async () => {
      const t = D('tasks').find((x) => x.id === b.dataset.task); if (!t) return;
      const done = t.status === 'done';
      b.disabled = true;
      try { await A.update('tasks', done ? { status: 'open', done_at: null } : { status: 'done', done_at: new Date().toISOString() }, { id: t.id }, ['tasks']); toast(done ? 'Reopened' : 'Done'); } catch (e) { /* toast shown */ }
      A.render();
    }));
    const f = root.querySelector('#addTask');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault(); const title = f.title.value.trim(); if (!title) return;
      try { await A.insert('tasks', { title, who: 'nick', source: 'app' }, ['tasks']); toast('Added'); } catch (err) { return; }
      A.render();
    });
    root.querySelectorAll('[data-close-item]').forEach((b) => b.addEventListener('click', async () => {
      const key = b.dataset.closeItem; const doc = closeToday() || {}; const items = Object.assign({}, doc.items || {});
      const was = !!(items[key] && items[key].done);
      items[key] = { done: !was, at: !was ? new Date().toISOString() : null, by: A.state.session.user.id };
      b.disabled = true;
      try { await A.upsert('daily_close', { date: todayISO(), items }, 'date', ['close']); } catch (e) { /* toast shown */ }
      A.render();
    }));
    const note = root.querySelector('#drawerNote');
    if (note) note.addEventListener('change', async () => {
      const doc = closeToday() || {};
      try { await A.upsert('daily_close', { date: todayISO(), items: doc.items || {}, drawer_note: note.value.trim() }, 'date', ['close']); toast('Saved'); } catch (e) { /* toast shown */ }
    });
  };

  // ------------------------------------------------------------ Timecards (+ schedule)
  const TC_KEYS = ['timecards', 'fixes', 'schedule'];
  A.titles.timecards = 'Timecards';
  A.views.timecards = function () {
    if (!A.ensure(TC_KEYS)) return A.loading();
    const cards = D('timecards'); const odd = oddCards(); const pend = D('fixes').filter((f) => f.status === 'pending');
    const weekAgo = Date.now() - 7 * 86400000; const h7 = sum(cards.filter((c) => c.out_at && stamp(c.in_at) >= weekAgo), (c) => c.hours);
    const openNow = cards.filter((c) => !c.out_at);
    const at = cards.reduce((m, c) => (c.as_of && c.as_of > m ? c.as_of : m), '');
    const rows = ui.cardsAll ? cards : odd;
    const isKevin = A.role() === 'kevin';
    return `${A.errorsFor(TC_KEYS)}<h1>Timecards</h1>
      <div class="stats">
        <div class="stat"><span class="l">Odd cards</span><span class="v ${odd.length ? 'neg' : ''}">${odd.length}</span><span class="s">auto, 14 h+, or left open</span></div>
        <div class="stat"><span class="l">Fixes waiting</span><span class="v">${pend.length}</span><span class="s">${pend.length ? 'Kevin applies them in Square' : 'none'}</span></div>
        <div class="stat"><span class="l">Hours, 7 days</span><span class="v">${hrs(h7)}</span><span class="s">closed cards</span></div>
        <div class="stat"><span class="l">Clocked in now</span><span class="v">${openNow.length}</span><span class="s">${esc(openNow.map((c) => c.name).join(', ') || 'nobody')}</span></div>
      </div>
      <section class="card">
        <div class="spread"><div class="seg"><button type="button" class="${ui.cardsAll ? '' : 'on'}" data-cards="odd">Odd only</button><button type="button" class="${ui.cardsAll ? 'on' : ''}" data-cards="all">All ${cards.length}</button></div><span class="tiny muted">${at ? 'from Square ' + esc(ago(at)) : ''}</span></div>
        ${rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Who</th><th class="txt">Job</th><th>In</th><th>Out</th><th>Hours</th><th class="txt">Why</th><th></th></tr></thead><tbody>${rows.map(cardRow).join('')}</tbody></table></div>` : `<div class="empty">${cards.length ? 'All cards look normal.' : 'No timecards yet. The morning run brings them.'}</div>`}
      </section>
      <h2>Fixes <span class="sub">Nick asks; Kevin changes the card in Square</span></h2>
      <section class="card">${fixList(isKevin)}</section>
      <h2>Schedule <span class="sub">built from last week's timecards; Kevin sends it to Square</span></h2>
      <section class="card">${scheduleCard()}</section>`;
  };
  function cardRow(c) {
    const why = cardWhy(c); const f = fixFor(c); const key = c.shift_id || (c.name + c.in_at);
    const act = f ? `<span class="chip ${f.status === 'applied' ? 'good' : 'warn'}">${f.status === 'applied' ? 'fixed' : 'fix saved'}</span>` : why ? `<button class="sm" data-fix="${esc(key)}">Fix</button>` : '';
    let html = `<tr><td class="txt">${esc(c.name)}</td><td class="txt">${esc(c.job || '')}</td><td>${esc(fmtStamp(c.in_at))}</td><td>${c.out_at ? esc(fmtStamp(c.out_at)) : 'open'}</td><td>${c.hours == null ? '—' : Number(c.hours).toFixed(1)}</td><td class="txt">${why ? dot(c.auto || Number(c.hours) >= 20 ? 'crit' : 'warn') + ' ' + esc(why) : ''}</td><td>${act}</td></tr>`;
    if (ui.fixOpen === key) {
      const def = String(c.in_at).slice(0, 10) + 'T20:30';
      html += `<tr><td class="txt wrap" colspan="7"><form class="row" data-fixform="${esc(key)}"><label class="f" style="margin:0;flex:1;min-width:190px">Real clock-out<input type="datetime-local" name="out" step="60" value="${esc(def)}" required></label><label class="f" style="margin:0;flex:2;min-width:190px">Note (optional)<input name="note" maxlength="300"></label><button class="primary" type="submit">Save</button><button type="button" data-fixcancel>Cancel</button></form></td></tr>`;
    }
    return html;
  }
  function fixList(isKevin) {
    const fx = D('fixes').slice(0, ui.allFixes ? 300 : 12);
    if (!fx.length) return '<div class="empty">No fixes asked for yet.</div>';
    const me = A.state.session.user.id;
    return `<div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Who</th><th>Clock-in</th><th>Was</th><th>Should be</th><th class="txt">Status</th><th class="txt">Note</th><th></th></tr></thead><tbody>
      ${fx.map((f) => `<tr><td class="txt">${esc(f.name)}</td><td>${esc(fmtStamp(f.in_at))}</td><td>${f.out_old ? esc(fmtStamp(f.out_old)) : 'open'}</td><td>${esc(fmtStamp(f.out_new))}</td><td class="txt"><span class="chip ${f.status === 'applied' ? 'good' : f.status === 'rejected' ? 'bad' : 'warn'}">${esc(f.status === 'applied' ? 'done in Square' : f.status)}</span></td><td class="txt wrap">${esc(f.note || '')}</td>
        <td>${isKevin && f.status === 'pending' ? `<button class="sm primary" data-fixset="applied" data-id="${f.id}">Done in Square</button> <button class="sm" data-fixset="rejected" data-id="${f.id}">Reject</button>` : !isKevin && f.status === 'pending' && f.created_by === me ? `<button class="sm" data-fixdel="${f.id}">Withdraw</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>${D('fixes').length > 12 ? `<button class="quiet sm" data-allfixes>${ui.allFixes ? 'Fewer' : 'All ' + D('fixes').length}</button>` : ''}`;
  }

  // Schedule: draft for this week or next, from last week's closed timecards (same weekday, 15-minute times).
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const q15 = (hhmm) => { const m = /^(\d{2}):(\d{2})/.exec(hhmm || ''); if (!m) return hhmm; let mins = Math.round((+m[1] * 60 + +m[2]) / 15) * 15; mins = Math.min(mins, 23 * 60 + 45); return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); };
  const hm12 = (hhmm) => { const m = /^(\d{2}):(\d{2})/.exec(hhmm || ''); if (!m) return hhmm || ''; let hh = +m[1]; const ap = hh >= 12 ? 'p' : 'a'; hh = hh % 12 || 12; return hh + (m[2] === '00' ? '' : ':' + m[2]) + ap; };
  const shiftHours = (sh) => { const a = /^(\d{2}):(\d{2})/.exec(sh.start), b = /^(\d{2}):(\d{2})/.exec(sh.end); if (!a || !b) return 0; const v = ((+b[1] * 60 + +b[2]) - (+a[1] * 60 + +a[2])) / 60; return v > 0 ? v : v + 24; };
  function schedWeekOf() { const thisMon = mondayOf(todayISO()); return ui.schedWeek || addDays(thisMon, 7); }
  function buildFromLastWeek(week) {
    const lastMon = addDays(week, -7);
    const out = {};
    D('timecards').forEach((c) => {
      const d = String(c.in_at).slice(0, 10); if (d < lastMon || d >= week || !c.out_at) return;
      const day = addDays(d, 7); const key = (c.tm || c.name) + '|' + day;
      const start = q15(String(c.in_at).slice(11, 16)); let end = q15(String(c.out_at).slice(11, 16));
      if (String(c.out_at).slice(0, 10) !== d && end <= start) end = '23:45';
      if (!out[key]) out[key] = { tm: c.tm || '', name: c.name, job: c.job || '', day, start, end };
      else { if (start < out[key].start) out[key].start = start; if (end > out[key].end) out[key].end = end; }
    });
    return Object.values(out);
  }
  function scheduleCard() {
    const week = schedWeekOf(); const thisMon = mondayOf(todayISO()); const doc = D('schedule').find((s) => s.week_of === week);
    const isKevin = A.role() === 'kevin';
    const bar = `<div class="row" style="margin-bottom:8px"><div class="seg"><button type="button" class="${week === thisMon ? 'on' : ''}" data-sweek="${thisMon}">This week</button><button type="button" class="${week !== thisMon ? 'on' : ''}" data-sweek="${addDays(thisMon, 7)}">Next week</button></div>
      <span class="small muted">week of ${esc(fmtDate(week))}</span>${doc ? `<span class="chip ${doc.status === 'sent' ? 'good' : doc.status === 'ready' ? 'info' : ''}">${doc.status === 'sent' ? 'in Square' : doc.status === 'ready' ? 'ready for Square' : 'draft'}</span>` : ''}</div>`;
    const shifts = (doc && doc.shifts) || [];
    if (!shifts.length) {
      const have = buildFromLastWeek(week).length;
      return bar + `<div class="empty">No schedule yet.</div><button class="primary" data-sbuild ${have ? '' : 'disabled title="No timecards for last week yet"'}>Start from last week</button>`;
    }
    const people = {};
    shifts.forEach((sh) => { const k = sh.tm || sh.name; const p = people[k] || (people[k] = { key: k, name: sh.name, job: sh.job, days: {}, hours: 0 }); p.days[sh.day] = sh; if (!sh.off) p.hours += shiftHours(sh); });
    const rows = Object.values(people).sort((a, b) => (a.job + a.name).localeCompare(b.job + b.name));
    const dayHours = [0, 0, 0, 0, 0, 0, 0];
    const locked = doc.status === 'sent' && !isKevin;
    const body = rows.map((p) => `<tr><td class="who">${esc(p.name)}<span>${esc(p.job || '')}</span></td>${DAYS.map((dn, i) => {
      const date = addDays(week, i); const sh = p.days[date]; if (sh && !sh.off) dayHours[i] += shiftHours(sh);
      const key = p.key + '|' + date;
      if (ui.cellOpen === key) return `<td><form class="cellform" data-cell="${esc(key)}"><input type="time" name="a" step="900" value="${esc(sh && !sh.off ? sh.start : '11:30')}"><input type="time" name="b" step="900" value="${esc(sh && !sh.off ? sh.end : '20:00')}"><button class="sm primary" type="submit">Save</button><button class="sm" type="button" data-celloff="${esc(key)}">Off</button><button class="sm quiet" type="button" data-cellcancel>Cancel</button></form></td>`;
      return `<td><button type="button" class="cell ${sh && !sh.off ? '' : 'off'}" data-cellopen="${esc(key)}" ${locked ? 'disabled' : ''}>${sh && !sh.off ? hm12(sh.start) + '–' + hm12(sh.end) : 'off'}</button></td>`;
    }).join('')}<td class="mono ${p.hours >= 40 ? 'neg' : ''}">${p.hours.toFixed(1)}</td></tr>`).join('');
    const foot = `<tr><td class="who">Hours</td>${dayHours.map((v) => `<td>${v.toFixed(1)}</td>`).join('')}<td>${dayHours.reduce((a, b) => a + b, 0).toFixed(1)}</td></tr>`;
    const actions = isKevin
      ? `${doc.status !== 'sent' ? '<button class="primary" data-sstatus="sent">Mark sent to Square</button>' : '<button data-sstatus="draft">Back to draft</button>'}`
      : doc.status === 'draft' ? '<button class="primary" data-sstatus="ready">Ready for Kevin to send</button>' : doc.status === 'ready' ? '<button data-sstatus="draft">Back to draft</button>' : '';
    return bar + `<div class="sched"><table class="sch"><thead><tr><th>Who</th>${DAYS.map((d, i) => `<th class="day">${d}<span>${esc(fmtDate(addDays(week, i)))}</span></th>`).join('')}<th>Hours</th></tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
      <div class="row" style="margin-top:8px">${actions}${doc.sent_at ? `<span class="small muted">sent ${esc(fmtTime(doc.sent_at))}</span>` : ''}</div>`;
  }
  async function saveSchedule(week, shifts, extra) {
    const doc = D('schedule').find((s) => s.week_of === week) || {};
    const row = Object.assign({ week_of: week, status: doc.status || 'draft', shifts }, extra || {});
    try { await A.upsert('schedule_weeks', row, 'week_of', ['schedule']); } catch (e) { /* toast shown */ }
    A.render();
  }

  A.wires.timecards = function (root) {
    root.querySelectorAll('[data-cards]').forEach((b) => b.addEventListener('click', () => { ui.cardsAll = b.dataset.cards === 'all'; ui.fixOpen = null; A.render(); }));
    root.querySelectorAll('[data-fix]').forEach((b) => b.addEventListener('click', () => { ui.fixOpen = ui.fixOpen === b.dataset.fix ? null : b.dataset.fix; A.render(); }));
    root.querySelectorAll('[data-fixcancel]').forEach((b) => b.addEventListener('click', () => { ui.fixOpen = null; A.render(); }));
    root.querySelectorAll('[data-fixform]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = f.dataset.fixform; const c = D('timecards').find((x) => (x.shift_id || (x.name + x.in_at)) === key); if (!c) return;
      const out = f.out.value; if (!out || stamp(out) <= stamp(c.in_at)) { toast('Pick a time after clock-in'); return; }
      f.querySelector('button[type=submit]').disabled = true;
      try {
        await A.insert('timecard_fixes', { shift_id: c.shift_id, tm: c.tm, name: c.name, in_at: c.in_at, out_old: c.out_at, out_new: out.slice(0, 16), hours_old: c.hours, note: f.note.value.trim() || null }, ['fixes']);
        toast('Saved for Kevin to apply in Square'); ui.fixOpen = null;
      } catch (err) { /* toast shown */ }
      A.render();
    }));
    root.querySelectorAll('[data-fixset]').forEach((b) => b.addEventListener('click', async () => {
      const st = b.dataset.fixset;
      try { await A.update('timecard_fixes', { status: st, applied_at: st === 'applied' ? new Date().toISOString() : null }, { id: b.dataset.id }, ['fixes']); toast(st === 'applied' ? 'Marked done' : 'Rejected'); } catch (e) { /* toast */ }
      A.render();
    }));
    root.querySelectorAll('[data-fixdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Withdraw this fix?')) return;
      try { await A.remove('timecard_fixes', { id: b.dataset.fixdel }, ['fixes']); toast('Withdrawn'); } catch (e) { /* toast */ }
      A.render();
    }));
    root.querySelectorAll('[data-allfixes]').forEach((b) => b.addEventListener('click', () => { ui.allFixes = !ui.allFixes; A.render(); }));
    // schedule
    root.querySelectorAll('[data-sweek]').forEach((b) => b.addEventListener('click', () => { ui.schedWeek = b.dataset.sweek; ui.cellOpen = null; A.render(); }));
    const build = root.querySelector('[data-sbuild]');
    if (build) build.addEventListener('click', () => { const week = schedWeekOf(); const sh = buildFromLastWeek(week); if (!sh.length) { toast('Nothing to copy'); return; } saveSchedule(week, sh, { status: 'draft' }).then(() => toast('Draft from last week')); });
    root.querySelectorAll('[data-cellopen]').forEach((b) => b.addEventListener('click', () => { ui.cellOpen = b.dataset.cellopen; A.render(); }));
    root.querySelectorAll('[data-cellcancel]').forEach((b) => b.addEventListener('click', () => { ui.cellOpen = null; A.render(); }));
    const cellParts = (key) => { const i = key.lastIndexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };
    root.querySelectorAll('[data-cell]').forEach((f) => f.addEventListener('submit', (e) => {
      e.preventDefault(); const week = schedWeekOf(); const doc = D('schedule').find((s) => s.week_of === week) || { shifts: [] };
      const [pk, date] = cellParts(f.dataset.cell); if (!f.a.value || !f.b.value) { toast('Pick both times'); return; }
      const ref = doc.shifts.find((x) => (x.tm || x.name) === pk) || {};
      const next = doc.shifts.filter((x) => !((x.tm || x.name) === pk && x.day === date));
      next.push({ tm: ref.tm || '', name: ref.name, job: ref.job || '', day: date, start: q15(f.a.value), end: q15(f.b.value) });
      ui.cellOpen = null; saveSchedule(week, next);
    }));
    root.querySelectorAll('[data-celloff]').forEach((b) => b.addEventListener('click', () => {
      const week = schedWeekOf(); const doc = D('schedule').find((s) => s.week_of === week) || { shifts: [] };
      const [pk, date] = cellParts(b.dataset.celloff); const ref = doc.shifts.find((x) => (x.tm || x.name) === pk) || {};
      const next = doc.shifts.filter((x) => !((x.tm || x.name) === pk && x.day === date));
      if (!next.some((x) => (x.tm || x.name) === pk)) next.push({ tm: ref.tm || '', name: ref.name, job: ref.job || '', day: date, start: '00:00', end: '00:00', off: true });
      ui.cellOpen = null; saveSchedule(week, next);
    }));
    root.querySelectorAll('[data-sstatus]').forEach((b) => b.addEventListener('click', () => {
      const week = schedWeekOf(); const doc = D('schedule').find((s) => s.week_of === week); if (!doc) return;
      const st = b.dataset.sstatus;
      saveSchedule(week, doc.shifts, { status: st, sent_at: st === 'sent' ? new Date().toISOString() : doc.sent_at || null }).then(() => toast(st === 'ready' ? 'Kevin will send it to Square' : st === 'sent' ? 'Marked in Square' : 'Back to draft'));
    }));
  };

  // ------------------------------------------------------------ Payroll ask
  A.titles.payroll = 'Payroll';
  A.views.payroll = function () {
    if (!A.ensure(['payroll'])) return A.loading();
    const pp = payPeriods(); const cur = pp.cur;
    const isKevin = A.role() === 'kevin';
    let html = `${A.errorsFor(['payroll'])}<h1>Payroll ask</h1><p class="small muted">Kevin needs Angel's hours and a photo of Jeff's board to run payroll. Periods end every other Sunday; payroll runs that Thursday or Friday.</p>`;
    if (!cur) {
      html += `<section class="card"><div class="row">${dot('wait')}<b>Payroll through ${esc(fmtDate(pp.next.end))}</b></div><p class="small">Angel's hours and a photo of Jeff's board are due ${esc(fmtDay(pp.next.ask))}. This is where you'll send them.</p><p class="tiny muted">Until then, payroll through Oct 25 stays on the current desk page.</p></section>`;
    } else {
      html += `<section class="card" id="payCard">${payCard(cur)}</section>`;
      if (payDoc(cur.end) && payDoc(cur.end).sent_at && !ui.payEdit) html += `<p class="small muted">Next: payroll through ${esc(fmtDate(pp.next.end))}, due ${esc(fmtDay(pp.next.ask))}.</p>`;
    }
    const past = D('payroll').filter((p) => !cur || p.period_end !== cur.end);
    if (past.length) html += `<h2>Earlier periods</h2><section class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Period</th><th>Angel</th><th>Jeff's pieces</th><th class="txt">Board erased</th><th class="txt">Sent</th><th></th></tr></thead><tbody>
      ${past.map((p) => `<tr><td class="txt">${esc(fmtDate(p.period_start))} – ${esc(fmtDate(p.period_end))}</td><td>${hrs(num(p.angel_hours))}</td><td>${p.jeff_pieces == null ? '—' : p.jeff_pieces}</td><td class="txt">${p.board_erased ? 'yes' : 'no'}</td><td class="txt">${p.sent_at ? esc(fmtTime(p.sent_at)) : 'not sent'}</td><td>${p.photo_path ? `<button class="sm" data-photo="${esc(p.photo_path)}">Photo</button>` : ''}</td></tr>`).join('')}</tbody></table></div></section>`;
    if (isKevin) html += '<p class="tiny muted">The 6:15 run turns a sent ask into a launch pad task, as it does for the desk today.</p>';
    return html;
  };
  function payCard(cur) {
    const d = payDoc(cur.end) || {};
    if (d.sent_at && !ui.payEdit) {
      const url = d.photo_path ? ui.photoUrl[d.photo_path] : null;
      return `<div class="row">${dot('good')}<b>Payroll through ${esc(fmtDate(cur.end))} sent</b><span class="small muted">${esc(fmtTime(d.sent_at))}</span></div>
        <div class="row small" style="margin-top:6px"><span>Angel ${hrs(num(d.angel_hours))}</span><span>· Jeff ${d.jeff_pieces == null ? 'count from the photo' : d.jeff_pieces + ' pieces'}</span><span class="${d.board_erased ? '' : 'neg'}">· ${d.board_erased ? 'board erased after last count' : 'board NOT erased after last count'}</span></div>
        ${d.photo_path ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img class="payimg" src="${esc(url)}" alt="Jeff's board"></a>` : `<button class="sm" data-photo="${esc(d.photo_path)}" style="margin-top:8px">Show photo</button>`) : ''}
        ${d.note ? `<p class="small">Note: ${esc(d.note)}</p>` : ''}
        <div style="margin-top:8px"><button data-payedit>Change</button></div>`;
    }
    const f = ui.payForm;
    if (!ui.payFormFor || ui.payFormFor !== cur.end) {
      ui.payFormFor = cur.end;
      Object.assign(f, { hours: d.angel_hours == null ? '' : String(d.angel_hours), pieces: d.jeff_pieces == null ? '' : String(d.jeff_pieces), erased: !!d.board_erased, photo: d.photo_path || null, note: d.note || '' });
    }
    return `<div class="row">${dot('warn')}<b>Payroll through ${esc(fmtDate(cur.end))}</b><span class="small muted">due ${esc(fmtDay(cur.ask))}</span></div>
      <form id="payForm" style="margin-top:10px">
        <div class="pf">
          <label class="f">Angel's hours, ${esc(fmtDate(cur.start))} – ${esc(fmtDate(cur.end))}<input name="hours" type="number" min="0" max="200" step="0.25" inputmode="decimal" placeholder="hours" value="${esc(f.hours)}" required></label>
          <label class="f">Pieces on Jeff's board (optional)<input name="pieces" type="number" min="0" max="5000" step="1" inputmode="numeric" placeholder="pieces" value="${esc(f.pieces)}"></label>
        </div>
        <label class="f">Photo of Jeff's board<input name="photo" type="file" accept="image/*" capture="environment"></label>
        <div id="payPhoto" class="small muted">${f.photo ? 'Photo added.' : ui.payBusy ? 'Uploading…' : ''}</div>
        <label class="ck"><input name="erased" type="checkbox" ${f.erased ? 'checked' : ''}> The board was erased after the last count</label>
        <label class="f">Note<input name="note" maxlength="300" placeholder="anything Kevin should know" value="${esc(f.note)}"></label>
        <div class="row"><button class="primary" type="submit" ${ui.payBusy ? 'disabled' : ''}>Send to Kevin</button>${ui.payEdit ? '<button type="button" data-paycancel>Cancel</button>' : ''}<span class="small muted" id="payHint"></span></div>
      </form>`;
  }
  // Phone photos are large; send a 2000 px JPEG when the browser can redraw it.
  function shrinkPhoto(file) {
    if (!window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file).then((bmp) => {
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.85));
    }).catch(() => file);
  }
  async function showPhoto(path) {
    const { data, error } = await A.db().storage.from('payroll-photos').createSignedUrl(path, 300);
    if (error || !data) { toast('Couldn\'t open the photo'); return; }
    ui.photoUrl[path] = data.signedUrl; A.render();
  }
  A.wires.payroll = function (root) {
    root.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => showPhoto(b.dataset.photo)));
    const e1 = root.querySelector('[data-payedit]'); if (e1) e1.addEventListener('click', () => { ui.payEdit = true; ui.payFormFor = null; A.render(); });
    const c1 = root.querySelector('[data-paycancel]'); if (c1) c1.addEventListener('click', () => { ui.payEdit = false; ui.payFormFor = null; A.render(); });
    const form = root.querySelector('#payForm'); if (!form) return;
    const cur = payPeriods().cur; const f = ui.payForm;
    const hint = () => { const h = parseFloat(form.hours.value); root.querySelector('#payHint').textContent = isNaN(h) ? 'Add Angel\'s hours.' : !f.photo ? 'Add the photo of Jeff\'s board.' : ''; };
    ['hours', 'pieces', 'note'].forEach((k) => form[k].addEventListener('input', () => { f[k] = form[k].value; hint(); }));
    form.erased.addEventListener('change', () => { f.erased = form.erased.checked; });
    form.photo.addEventListener('change', async () => {
      const file = form.photo.files && form.photo.files[0]; if (!file) return;
      ui.payBusy = true; root.querySelector('#payPhoto').textContent = 'Uploading…'; form.querySelector('button[type=submit]').disabled = true;
      try {
        const blob = await shrinkPhoto(file);
        const path = `${cur.end}/board-${Date.now()}.jpg`;
        const { error } = await A.db().storage.from('payroll-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (error) throw error;
        f.photo = path; toast('Photo added');
      } catch (e) { toast('Couldn\'t upload: ' + (e.message || e)); }
      ui.payBusy = false; root.querySelector('#payPhoto').textContent = f.photo ? 'Photo added.' : ''; form.querySelector('button[type=submit]').disabled = false; hint();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hours = parseFloat(form.hours.value); const pieces = form.pieces.value === '' ? null : parseInt(form.pieces.value, 10);
      if (isNaN(hours) || hours < 0 || hours > 200) { toast('Add Angel\'s hours'); return; }
      if (!f.photo) { toast('Add the photo of Jeff\'s board'); return; }
      form.querySelector('button[type=submit]').disabled = true;
      try {
        await A.upsert('payroll_asks', { period_end: cur.end, period_start: cur.start, angel_hours: hours, jeff_pieces: isNaN(pieces) ? null : pieces, board_erased: form.erased.checked, photo_path: f.photo, note: form.note.value.trim().slice(0, 300) || null, sent_at: new Date().toISOString(), sent_by: A.state.session.user.id }, 'period_end', ['payroll']);
        ui.payEdit = false; ui.payFormFor = null; toast('Sent to Kevin');
      } catch (err) { /* toast shown */ }
      A.render();
    });
    hint();
  };
})();
