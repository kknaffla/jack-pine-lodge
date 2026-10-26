/* Kevin's Home, Performance (Kevin and Nick), golf course spend (everyone), More. */
(function () {
  'use strict';
  const A = window.JPL;
  const { esc, num, todayISO, addDays, mondayOf, fmtDate, fmtDay, fmtTime, ago, money, money2, hrs, pctChip, sum, groupBy, titleCase, dot, isStale, toast, D } = A;
  const ui = { range: null, line: null, cat: null, taskWho: 'kevin', showDone: false };
  const kdoc = (key) => (D('kdocs').find((d) => d.key === key) || null);

  // ------------------------------------------------------------ Home (Kevin)
  const HOME_KEYS = ['kdocs', 'sales_recent', 'drawers', 'timecards', 'fixes', 'tasks', 'attention', 'briefs', 'payroll', 'schedule', 'charges', 'answers', 'ckevin', 'runs', 'camplife', 'camplife_bal'];
  A.titles.home = 'Home';
  A.views.home = function () {
    if (!A.ensure(HOME_KEYS)) return A.loading();
    const tilesDoc = kdoc('tiles'); const tv = (tilesDoc && tilesDoc.data) || {};
    const days = A.desk.salesDays(); const y = addDays(todayISO(), -1); const ys = (days.find((d) => d.day === y) || {}).net;
    const last = A.desk.lastClose(); const fix = A.desk.toFix().length; const pend = D('fixes').filter((f) => f.status === 'pending').length;
    const km = {}; D('ckevin').forEach((r) => { km[r.charge_id] = r; });
    // Same count as the bookkeeping tool's attention list: rows needing an answer, not yet posted.
    const mine = D('charges').filter((c) => c.action !== 'POSTED' && !c.posted_at && A.charges.statusOf(c, A.charges.responsible(c), km) === 'q').length;
    const held = Object.values(km).filter((r) => r.held_reason).length;
    const myTasks = D('tasks').filter((t) => t.who === 'kevin' && t.status !== 'done').length;
    const tiles = [
      ['Operating cash', tv.checking != null ? money(num(tv.checking)) : '—', tv.bank != null ? 'all banks ' + money(num(tv.bank)) : 'checking', '#/backup', tilesDoc && tilesDoc.at],
      ['Yesterday\'s sales', ys == null ? '—' : money(ys), fmtDay(y), '#/performance', null],
      ['Cash drawer', last ? money2(num(last.counted)) : '—', last ? fmtDate(last.date) + ' · ' + A.desk.osText(num(last.over_short)) : '', '#/today', null],
      ['Timecards', String(fix), pend ? pend + ' fix' + (pend === 1 ? '' : 'es') + ' to apply' : fix ? 'to fix' : 'clean', '#/timecards', null],
      ['Card charges', String(mine), held ? 'need an answer · ' + held + ' held' : 'need an answer', '#/cards', null],
      ['My tasks', String(myTasks), 'open', null, null]
    ];
    const brief = D('briefs').find((b) => b.audience === 'kevin');
    return `${A.errorsFor(HOME_KEYS)}
      <h1>${esc(fmtDate(todayISO(), { weekday: 'long', month: 'long', day: 'numeric' }))}</h1>
      <div class="attn">${attention()}</div>
      <div class="tiles k6">${tiles.map(([l, v, s, href, at]) => { const inner = `<span class="l">${esc(l)}</span><span class="v">${esc(v)}</span><span class="s">${esc(s)}</span>`; return href ? `<a class="tile ${at && isStale(at) ? 'stale' : ''}" href="${href}">${inner}</a>` : `<button type="button" class="tile" data-scrollto="tasks">${inner}</button>`; }).join('')}</div>
      <div class="grid2" style="margin-top:12px">
        <section class="card" id="tasks">${tasksCard()}</section>
        <div>
          <section class="card">${payrollCard()}</section>
          <section class="card">${statusCard()}</section>
        </div>
      </div>
      <section class="card" style="margin-top:12px">${briefCard(brief)}</section>
      <section class="card" style="margin-top:12px">${campCard()}</section>`;
  };

  function attention() {
    const items = [];
    const add = (lvl, text, href) => items.push({ lvl, text, href });
    D('attention').filter((a) => a.audience === 'kevin').forEach((a) => add(a.level, (a.count != null && /^[a-z]/.test(a.label) ? a.count + ' ' : '') + a.label, a.link === 'feed' || a.link === 'charges' ? '#/cards' : null));
    const pend = D('fixes').filter((f) => f.status === 'pending').length;
    if (pend) add('warn', pend + (pend === 1 ? ' timecard fix' : ' timecard fixes') + ' to make in Square', '#/timecards');
    const pp = A.payPeriods(); const cur = pp.cur;
    if (cur) { const d = A.payDoc(cur.end); add(d && d.sent_at ? 'good' : 'crit', d && d.sent_at ? 'Payroll through ' + fmtDate(cur.end) + ': Nick sent it' : 'Payroll through ' + fmtDate(cur.end) + ': waiting on Nick', '#/payroll'); }
    const ready = D('schedule').filter((s) => s.status === 'ready');
    ready.forEach((s) => add('warn', 'Schedule for week of ' + fmtDate(s.week_of) + ' ready to send to Square', '#/timecards'));
    const run = D('runs')[0];
    if (!run || isStale(run.at)) add('warn', 'App feed hasn\'t run since ' + (run ? fmtTime(run.at) : 'setup'));
    else if (!run.ok) add('crit', 'App feed failed: ' + (run.summary || ''));
    const rank = { crit: 0, warn: 1, wait: 2, good: 3 };
    return items.sort((a, b) => rank[a.lvl] - rank[b.lvl]).map((i) => (i.href ? `<a class="a" href="${i.href}">${dot(i.lvl)}${esc(i.text)}</a>` : `<span class="a">${dot(i.lvl)}${esc(i.text)}</span>`)).join('') || '<span class="a">' + dot('good') + 'nothing needs you</span>';
  }

  function tasksCard() {
    const whoF = ui.taskWho;
    const tasks = D('tasks').filter((t) => !whoF || t.who === whoF);
    const open = tasks.filter((t) => t.status !== 'done'); const done = tasks.filter((t) => t.status === 'done');
    const list = ui.showDone ? open.concat(done) : open;
    const linkFor = (t) => (A.safeUrl(t.link) ? `<a class="btn sm" href="${esc(t.link)}" target="_blank" rel="noopener">Open</a>` : '');
    return `<div class="spread"><h3>Tasks</h3><div class="seg">${[['kevin', 'Mine'], ['nick', 'Nick'], ['', 'All']].map(([k, l]) => `<button type="button" class="${whoF === k ? 'on' : ''}" data-taskwho="${k}">${l}</button>`).join('')}</div></div>
      ${list.length ? list.map((t) => `<div class="task ${t.status === 'done' ? 'done' : ''}"><button type="button" class="chk ${t.status === 'done' ? 'done' : ''}" data-ktask="${esc(t.id)}" aria-label="${t.status === 'done' ? 'Reopen' : 'Mark done'}"></button><div class="body"><div class="t">${esc(t.title)}${t.who !== 'kevin' ? ` <span class="chip">${esc(titleCase(t.who))}</span>` : ''}</div>${t.detail ? `<div class="d">${esc(t.detail)}</div>` : ''}</div>${linkFor(t)}</div>`).join('') : '<div class="empty">Nothing open.</div>'}
      ${done.length ? `<button class="quiet sm" data-kshowdone>${ui.showDone ? 'Hide done' : 'Show done (' + done.length + ')'}</button>` : ''}
      <form class="row" id="kAddTask" style="margin-top:8px"><input name="title" maxlength="200" placeholder="Add a task" aria-label="New task" style="flex:1;min-width:150px"><select name="who" style="width:auto"><option value="kevin">Me</option><option value="nick">Nick</option></select><button class="primary" type="submit">Add</button></form>`;
  }

  function payrollCard() {
    const pp = A.payPeriods(); const cur = pp.cur;
    if (!cur) return `<h3>Payroll</h3><p class="small">Through ${esc(fmtDate(pp.next.end))}: Nick's ask is due ${esc(fmtDay(pp.next.ask))}. Payroll through Oct 25 stays on the current desk.</p>`;
    const d = A.payDoc(cur.end);
    if (!d || !d.sent_at) return `<h3>Payroll through ${esc(fmtDate(cur.end))}</h3><p class="small">${dot('crit')} Waiting on Nick: Angel's hours and Jeff's board photo (due ${esc(fmtDay(cur.ask))}).</p><a href="#/payroll">Open payroll</a>`;
    return `<h3>Payroll through ${esc(fmtDate(cur.end))}</h3><p class="small">${dot('good')} Nick sent it ${esc(fmtTime(d.sent_at))}: Angel ${hrs(num(d.angel_hours))} · Jeff ${d.jeff_pieces == null ? 'count from photo' : d.jeff_pieces + ' pieces'} · board ${d.board_erased ? 'erased' : 'NOT erased'}.</p><a href="#/payroll">Photo and details</a>`;
  }

  function statusCard() {
    const st = (kdoc('statements') || {}).data || {}; const jobs = (kdoc('jobs') || {}).data || {};
    const stRows = Array.isArray(st) ? st : Object.entries(st).map(([k, v]) => Object.assign({ key: k }, typeof v === 'object' ? v : { status: v }));
    const jobRows = Object.values(jobs);
    const run = D('runs')[0];
    return `<h3>Statements and morning jobs</h3>
      ${stRows.length ? `<ul class="list">${stRows.map((r) => `<li><span>${dot(r.ok === false || r.status === 'mismatch' ? 'crit' : r.ok ? 'good' : 'wait')} ${esc(r.card || r.name || r.key || '')}</span><span class="muted small">${esc([r.through || r.period || '', r.status || '', r.summary || ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>` : '<div class="empty">No statement checks yet.</div>'}
      <ul class="list">${jobRows.map((j) => `<li><span>${dot(!j.ok ? 'crit' : isStale(j.finished) && j.task !== 'jack-pine-monday-brief' ? 'warn' : 'good')} ${esc(j.name || j.task)}</span><span class="muted small">${esc(j.ok ? ago(j.finished) : (j.error || 'failed'))}</span></li>`).join('')}
      <li><span>${dot(run && run.ok && !isStale(run.at) ? 'good' : 'warn')} App feed</span><span class="muted small">${run ? esc(ago(run.at)) : 'not run yet'}</span></li></ul>`;
  }

  function briefCard(b) {
    if (!b) return '<h3>Monday brief</h3><div class="empty">No brief yet. It lands Mondays at 7:00.</div>';
    const d = b.data || {}; const s = d.sales || {}; const l = d.labor || {}; const c = d.cash || {}; const bills = d.bills_due || {}; const close = d.close;
    return `<div class="spread"><h3>Monday brief</h3><span class="chip">week of ${esc(fmtDate(d.week_start || b.week_start))}${d.week_end ? ' – ' + esc(fmtDate(d.week_end)) : ''}</span></div>
      ${d.summary ? `<p class="lead small">${esc(d.summary)}</p>` : ''}
      <div class="stats">
        <div class="stat"><span class="l">Sales</span><span class="v">${money(num(s.this_week))}</span><span class="s">${pctChip(num(s.this_week), num(s.last_week), 'week before')}</span><span class="s">${pctChip(num(s.this_week), num(s.same_week_last_year), 'last year')}</span>${(s.by_day || []).length ? A.barStrip(s.by_day.map((x) => ({ label: fmtDate(x.day), v: num(x.net_sales) || 0 }))) : ''}</div>
        <div class="stat"><span class="l">Labor</span><span class="v">${hrs(num(l.hours))}</span>${(l.flags || []).map((f) => `<span class="s">${dot('warn')} ${esc(f)}</span>`).join('') || '<span class="s">no flags</span>'}</div>
        <div class="stat"><span class="l">Cash</span><span class="v">${money(num(c.checking))}</span><span class="s">drawer ${money(num(c.cash_drawer))} · clearing ${money(num(c.square_clearing))}</span><span class="s">undeposited ${money(num(c.undeposited_funds))}</span></div>
        <div class="stat"><span class="l">Waiting</span><span class="v">${num(d.bank_items_waiting) ?? '—'}</span><span class="s">bank items · ${num(bills.count) ?? 0} bills ${money(num(bills.total))}</span><span class="s">${num(d.decisions_waiting) ?? 0} decisions</span></div>
      </div>
      ${(d.off_pattern || []).length ? `<ul class="offlist">${d.off_pattern.map((x) => `<li>${dot('warn')}<span>${esc(x)}</span></li>`).join('')}</ul>` : ''}
      ${close ? `<p class="small">${esc(close.month || '')} close: ${num(close.done) ?? 0} of ${num(close.total) ?? 0} done${close.next ? ', next ' + esc(close.next) : ''}.</p>` : ''}
      ${(d.source_notes || []).length ? `<details><summary class="small muted">Notes</summary><ul class="small">${d.source_notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}`;
  }

  function campCard() {
    const c = D('camplife')[0]; const bal = D('camplife_bal')[0];
    const owe = (c && c.owing) || [];
    return `<div class="spread"><h3>CampLife</h3><span class="small muted">${c ? esc(fmtDate(c.date)) : ''}</span></div>
      <div class="stats">
        <div class="stat"><span class="l">Check-ins today</span><span class="v">${c ? (c.arrivals || []).length : '—'}</span></div>
        <div class="stat"><span class="l">Owe money</span><span class="v ${owe.length ? 'neg' : ''}">${owe.length ? money(sum(owe, (g) => g.amount)) : '0'}</span><span class="s">${owe.length} ${owe.length === 1 ? 'guest' : 'guests'}</span></div>
        <div class="stat"><span class="l">Advance deposits</span><span class="v">${bal ? money(num(bal.advance_deposit_balance)) : '—'}</span></div>
        <div class="stat"><span class="l">Future reservations</span><span class="v">${bal ? money(num(bal.future_reservation_total)) : '—'}</span><span class="s">${bal ? money(num(bal.future_reservation_balance)) + ' still due' : ''}</span></div>
      </div>`;
  }

  A.wires.home = function (root) {
    root.querySelectorAll('[data-scrollto]').forEach((b) => b.addEventListener('click', () => { const el = document.getElementById(b.dataset.scrollto); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }));
    root.querySelectorAll('[data-taskwho]').forEach((b) => b.addEventListener('click', () => { ui.taskWho = b.dataset.taskwho; A.render(); }));
    root.querySelectorAll('[data-kshowdone]').forEach((b) => b.addEventListener('click', () => { ui.showDone = !ui.showDone; A.render(); }));
    root.querySelectorAll('[data-ktask]').forEach((b) => b.addEventListener('click', async () => {
      const t = D('tasks').find((x) => x.id === b.dataset.ktask); if (!t) return; const done = t.status === 'done'; b.disabled = true;
      try { await A.update('tasks', done ? { status: 'open', done_at: null } : { status: 'done', done_at: new Date().toISOString() }, { id: t.id }, ['tasks']); } catch (e) { /* toast */ }
      A.render();
    }));
    const f = root.querySelector('#kAddTask');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault(); const title = f.title.value.trim(); if (!title) return;
      try { await A.insert('tasks', { title, who: f.who.value, source: 'app' }, ['tasks']); toast('Added'); } catch (err) { return; }
      A.render();
    });
  };

  // ------------------------------------------------------------ Performance (Kevin, Nick)
  const PERF_KEYS = ['sales', 'items', 'cats', 'hours', 'golf'];
  const LINE_ORDER = ['Food', 'Beer & Liquor', 'Store taxable', 'Grocery', 'Gasoline', 'Unmapped'];
  const NOT_SALES = { camplife: 'CampLife payments rung in Square', tips: 'Tips', gift_card: 'Gift cards sold' };
  A.titles.performance = 'Performance';
  function ranges() {
    const y = addDays(todayISO(), -1); const yr = y.slice(0, 4);
    const lyDate = (d) => String(+d.slice(0, 4) - 1) + d.slice(4);
    const wk = mondayOf(y);
    return {
      week: { label: 'This week', from: wk, to: y, lyFrom: addDays(wk, -364), lyTo: addDays(y, -364), grain: 'day' },
      month: { label: 'This month', from: y.slice(0, 8) + '01', to: y, lyFrom: lyDate(y.slice(0, 8) + '01'), lyTo: lyDate(y), grain: 'day' },
      season: { label: 'Season Apr–Oct', from: yr + '-04-01', to: y < yr + '-10-31' ? y : yr + '-10-31', lyFrom: (+yr - 1) + '-04-01', lyTo: lyDate(y < yr + '-10-31' ? y : yr + '-10-31'), grain: 'week' },
      year: { label: 'Year', from: yr + '-01-01', to: y, lyFrom: (+yr - 1) + '-01-01', lyTo: lyDate(y), grain: 'month' }
    };
  }
  function catMap() { const m = {}; D('cats').forEach((c) => { m[c.category] = c; }); return m; }
  function lineOf(cat, cm) { const c = cm[cat]; if (!c) return { line: 'Unmapped', treatment: 'income' }; return { line: c.treatment === 'income' ? c.line : (NOT_SALES[c.treatment] || c.line), treatment: c.treatment }; }
  const bucketOf = (day, grain) => (grain === 'day' ? day : grain === 'week' ? mondayOf(day) : day.slice(0, 7));
  A.views.performance = function () {
    if (!A.ensure(PERF_KEYS)) return A.loading();
    const R = ranges(); const key = ui.range && R[ui.range] ? ui.range : 'month'; const r = R[key];
    const cm = catMap();
    const inR = (d, a, b) => d >= a && d <= b;
    const rows = D('sales').filter((x) => inR(x.day, r.from, r.to)); const lyRows = D('sales').filter((x) => inR(x.day, r.lyFrom, r.lyTo));
    const income = (rs) => rs.filter((x) => lineOf(x.category, cm).treatment === 'income');
    const net = sum(income(rows), (x) => x.net_sales), lyNet = sum(income(lyRows), (x) => x.net_sales);
    const byDay = groupBy(income(rows), (x) => x.day); const dayTotals = Object.keys(byDay).map((d) => ({ day: d, v: sum(byDay[d], (x) => x.net_sales) }));
    const best = dayTotals.reduce((b, d) => (!b || d.v > b.v ? d : b), null);
    const nDays = A.dayDiff(r.to, r.from) + 1;
    // chart buckets, this year vs last year (last year's buckets moved forward a year)
    const shift = (d) => (key === 'week' ? addDays(d, 364) : String(+d.slice(0, 4) + 1) + d.slice(4));
    const buckets = {};
    income(rows).forEach((x) => { const b = bucketOf(x.day, r.grain); (buckets[b] = buckets[b] || { ty: 0, ly: 0 }).ty += Number(x.net_sales); });
    income(lyRows).forEach((x) => { const b = bucketOf(shift(x.day), r.grain); if (b < bucketOf(r.from, r.grain) || b > bucketOf(r.to, r.grain)) return; (buckets[b] = buckets[b] || { ty: 0, ly: 0 }).ly += Number(x.net_sales); });
    const bks = Object.keys(buckets).sort().map((b) => Object.assign({ b }, buckets[b]));
    const hoursRows = D('hours').filter((h) => h.period_end && inR(h.period_end, r.from, r.to) && h.hours != null);
    const hoursBy = groupBy(hoursRows, (h) => h.employee);
    const people = Object.keys(hoursBy).map((n) => ({ name: n, hours: sum(hoursBy[n], (h) => h.hours) })).sort((a, b) => b.hours - a.hours);
    const asOf = D('sales').reduce((m, x) => (x.as_of && x.as_of > m ? x.as_of : m), '');
    return `${A.errorsFor(PERF_KEYS)}<h1>Performance</h1>
      <div class="row" style="margin-bottom:10px"><div class="seg">${Object.entries(R).map(([k, v]) => `<button type="button" class="${k === key ? 'on' : ''}" data-range="${k}">${esc(v.label)}</button>`).join('')}</div><span class="small muted">${esc(fmtDate(r.from))} – ${esc(fmtDate(r.to))}${asOf ? ' · from Square ' + esc(ago(asOf)) : ''}</span></div>
      <div class="stats">
        <div class="stat"><span class="l">Net sales</span><span class="v">${money(net)}</span><span class="s">${pctChip(net, lyNet, 'last year')}</span></div>
        <div class="stat"><span class="l">Last year, same span</span><span class="v">${money(lyNet)}</span><span class="s">${esc(fmtDate(r.lyFrom, { year: 'numeric' }))} – ${esc(fmtDate(r.lyTo))}</span></div>
        <div class="stat"><span class="l">Per day</span><span class="v">${money(net / Math.max(1, nDays))}</span><span class="s">${nDays} days</span></div>
        <div class="stat"><span class="l">Best day</span><span class="v">${best ? money(best.v) : '—'}</span><span class="s">${best ? esc(fmtDay(best.day)) : ''}</span></div>
      </div>
      <section class="card"><div class="spread"><h3>Sales by ${r.grain}, this year against last</h3><span class="legend"><span><i style="background:var(--bar)"></i>${esc(r.to.slice(0, 4))}</span><span><i style="background:var(--bar-ly)"></i>last year</span></span></div>${chart(bks, r.grain)}</section>
      <section class="card" style="margin-top:12px">${linesTable(rows, lyRows, cm, r)}</section>
      <div class="grid2" style="margin-top:12px">
        <section class="card"><h3>Labor hours <span class="small muted">payroll periods ending in range · hours only</span></h3>
          ${people.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Who</th><th>Hours</th></tr></thead><tbody>${people.map((p) => `<tr><td class="txt">${esc(p.name)}</td><td>${p.hours.toFixed(1)}</td></tr>`).join('')}</tbody><tfoot><tr><td class="txt">Total</td><td>${sum(people, (p) => p.hours).toFixed(1)}</td></tr></tfoot></table></div>` : '<div class="empty">No payroll hours in this range yet.</div>'}</section>
        <section class="card">${golfCard()}</section>
      </div>`;
  };
  function chart(bks, grain) {
    if (!bks.length) return '<div class="empty">No sales in this range yet.</div>';
    const W = 640, H = 170, pad = 22, n = bks.length; const max = Math.max(1, ...bks.map((b) => Math.max(b.ty, b.ly)));
    const bw = (W - pad) / n; const w = Math.max(1, bw / 2 - 1);
    const lbl = (b) => (grain === 'month' ? new Date(b + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : fmtDate(b));
    const every = Math.ceil(n / 10);
    return `<svg class="chart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Sales by ${grain}">${bks.map((b, i) => {
      const x = pad + i * bw; const hy = (v) => Math.max(1, v / max * H);
      return `<rect class="ly" x="${x.toFixed(1)}" y="${(H - hy(b.ly)).toFixed(1)}" width="${w.toFixed(1)}" height="${hy(b.ly).toFixed(1)}"><title>${esc(lbl(b.b))} last year ${esc(money(b.ly))}</title></rect><rect class="ty" x="${(x + w + 1).toFixed(1)}" y="${(H - hy(b.ty)).toFixed(1)}" width="${w.toFixed(1)}" height="${hy(b.ty).toFixed(1)}"><title>${esc(lbl(b.b))} ${esc(money(b.ty))}</title></rect>${i % every === 0 ? `<text x="${(x + w).toFixed(1)}" y="${H + 13}" text-anchor="middle">${esc(lbl(b.b))}</text>` : ''}`;
    }).join('')}<text x="0" y="10">${esc(money(max))}</text></svg>`;
  }
  function linesTable(rows, lyRows, cm, r) {
    const agg = (rs, f) => { const m = {}; rs.forEach((x) => { const k = f(x); m[k] = (m[k] || 0) + Number(x.net_sales); }); return m; };
    const lineKey = (x) => lineOf(x.category, cm).line;
    if (ui.cat) {
      // items are monthly: the months this range touches
      const m1 = r.from.slice(0, 7), m2 = r.to.slice(0, 7);
      const its = D('items').filter((x) => x.category === ui.cat && x.month >= m1 && x.month <= m2);
      const by = agg(its, (x) => x.item || '(no item name)');
      const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
      return `<div class="spread"><h3>${esc(ui.cat)} <span class="small muted">items, ${esc(m1 === m2 ? m1 : m1 + ' to ' + m2)} (monthly)</span></h3><button class="quiet sm" data-back="cat">← ${esc(ui.line)}</button></div>
        ${list.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Item</th><th>Net sales</th></tr></thead><tbody>${list.map(([k, v]) => `<tr><td class="txt wrap">${esc(k)}</td><td>${money2(v)}</td></tr>`).join('')}</tbody><tfoot><tr><td class="txt">Total</td><td>${money2(sum(list, (x) => x[1]))}</td></tr></tfoot></table></div>` : '<div class="empty">No items on file for these months.</div>'}`;
    }
    if (ui.line) {
      const ty = agg(rows.filter((x) => lineKey(x) === ui.line), (x) => x.category); const ly = agg(lyRows.filter((x) => lineKey(x) === ui.line), (x) => x.category);
      const keys = [...new Set(Object.keys(ty).concat(Object.keys(ly)))].sort((a, b) => (ty[b] || 0) - (ty[a] || 0));
      return `<div class="spread"><h3>${esc(ui.line)} <span class="small muted">by Square category</span></h3><button class="quiet sm" data-back="line">← All tax lines</button></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Category</th><th>This period</th><th>Last year</th><th>Change</th></tr></thead><tbody>${keys.map((k) => `<tr class="click" data-cat="${esc(k)}"><td class="txt">${esc(k)}</td><td>${money(ty[k] || 0)}</td><td>${money(ly[k] || 0)}</td><td>${pctChip(ty[k] || 0, ly[k] || 0, '')}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const ty = agg(rows, lineKey), ly = agg(lyRows, lineKey);
    const keys = [...new Set(Object.keys(ty).concat(Object.keys(ly)))];
    const incomeLines = keys.filter((k) => !Object.values(NOT_SALES).includes(k)).sort((a, b) => (LINE_ORDER.indexOf(a) + 1 || 99) - (LINE_ORDER.indexOf(b) + 1 || 99));
    const other = keys.filter((k) => Object.values(NOT_SALES).includes(k));
    const row = (k) => `<tr class="click" data-line="${esc(k)}"><td class="txt">${esc(k)}</td><td>${money(ty[k] || 0)}</td><td>${money(ly[k] || 0)}</td><td>${pctChip(ty[k] || 0, ly[k] || 0, '')}</td></tr>`;
    return `<h3>Sales by tax line <span class="small muted">tap a line for its categories, then items</span></h3>
      <div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Line</th><th>This period</th><th>Last year</th><th>Change</th></tr></thead><tbody>${incomeLines.map(row).join('')}</tbody>
      <tfoot><tr><td class="txt">Net sales</td><td>${money(sum(incomeLines, (k) => ty[k] || 0))}</td><td>${money(sum(incomeLines, (k) => ly[k] || 0))}</td><td></td></tr></tfoot></table></div>
      ${other.length ? `<p class="small muted" style="margin:10px 0 2px">Not sales</p><div class="tblwrap"><table class="tbl"><tbody>${other.map(row).join('')}</tbody></table></div>` : ''}`;
  }
  A.wires.performance = function (root) {
    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { ui.range = b.dataset.range; A.render(); }));
    root.querySelectorAll('[data-line]').forEach((b) => b.addEventListener('click', () => { ui.line = b.dataset.line; ui.cat = null; A.render(); }));
    root.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { ui.cat = b.dataset.cat; A.render(); }));
    root.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.back === 'cat') ui.cat = null; else ui.line = null; A.render(); }));
  };

  // ------------------------------------------------------------ Golf course spend (everyone)
  function golfCard() {
    const g = D('golf'); if (!g.length) return '<h3>Golf course spend</h3><div class="empty">Nothing on file yet.</div>';
    const byM = groupBy(g, (x) => x.measure); const at = g.reduce((m, x) => (x.as_of && x.as_of > m ? x.as_of : m), '');
    const total = (m) => sum(byM[m] || [], (x) => x.amount);
    const totals = Object.keys(byM).map((m) => ({ m, label: (byM[m][0] || {}).label || m, amount: total(m), items: sum(byM[m], (x) => x.items) }));
    return `<h3>Golf course spend <span class="small muted">${esc(String(new Date().getFullYear()))}</span></h3>
      <dl class="kv">${totals.map((t) => `<dt>${esc(t.label)}</dt><dd>${money(t.amount)}${t.items ? ` <span class="muted small">· ${t.items} items</span>` : ''}</dd>`).join('')}</dl>
      <p class="tiny muted">${at ? 'As of ' + esc(fmtTime(at)) + '. ' : ''}Totals only.</p>`;
  }
  A.titles.golf = 'Golf course';
  A.views.golf = function () {
    if (!A.ensure(['golf'])) return A.loading();
    const g = D('golf'); const months = [...new Set(g.map((x) => x.month))].sort().reverse(); const measures = [...new Set(g.map((x) => x.measure))];
    const label = (m) => ((g.find((x) => x.measure === m) || {}).label || m);
    return `${A.errorsFor(['golf'])}<h1>Golf course spend</h1><section class="card">${golfCard()}</section>
      ${months.length ? `<h2>By month</h2><section class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">Month</th>${measures.map((m) => `<th>${esc(label(m))}</th>`).join('')}</tr></thead><tbody>
      ${months.map((mo) => `<tr><td class="txt">${esc(new Date(mo + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }))}</td>${measures.map((m) => { const r = g.find((x) => x.month === mo && x.measure === m); return `<td>${r ? money(num(r.amount)) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></section>` : ''}`;
  };

  // ------------------------------------------------------------ More
  A.titles.more = 'More';
  A.views.more = function () {
    const me = A.state.me || {}; const isKevin = A.role() === 'kevin';
    const th = A.currentTheme();
    return `<h1>More</h1>
      <section class="card menu">
        ${A.role() === 'nick' ? '<a href="#/performance">Performance <span>›</span></a><a href="#/golf">Golf course spend <span>›</span></a>' : ''}
        ${isKevin ? '<a href="#/timecards">Timecards and schedule <span>›</span></a><a href="#/payroll">Payroll ask <span>›</span></a><a href="#/golf">Golf course spend <span>›</span></a><a href="#/backup">Backup and feed log <span>›</span></a>' : ''}
      </section>
      <h2>Appearance <span class="sub">this device only</span></h2>
      <div class="seg" role="radiogroup" aria-label="Appearance">${[['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" role="radio" aria-checked="${th === k}" class="${th === k ? 'on' : ''}" data-theme-pick="${k}">${l}</button>`).join('')}</div>
      <h2>Account</h2>
      <section class="card"><p class="small">Signed in as <b>${esc(me.display_name || '')}</b> (${esc(A.state.session.user.email)}).</p><button id="signOut">Sign out</button></section>
      <section class="card"><form id="pwChange"><label class="f">New password<input type="password" name="pw" minlength="10" required autocomplete="new-password"></label>
        <label class="f">Same again<input type="password" name="pw2" minlength="10" required autocomplete="new-password"></label>
        <button class="primary" type="submit">Change password</button></form></section>
      <p class="tiny muted center">Version ${esc(A.APP_VERSION)}</p>`;
  };
  A.wires.more = function (root) {
    root.querySelectorAll('[data-theme-pick]').forEach((b) => b.addEventListener('click', () => { A.applyTheme(b.dataset.themePick); A.render(); }));
    const so = root.querySelector('#signOut'); if (so) so.addEventListener('click', A.signOut);
    const pf = root.querySelector('#pwChange');
    if (pf) pf.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (pf.pw.value !== pf.pw2.value) { toast('The two passwords differ'); return; }
      const btn = pf.querySelector('button'); btn.disabled = true;
      const { error } = await A.db().auth.updateUser({ password: pf.pw.value });
      btn.disabled = false;
      if (error) toast(error.message); else { pf.reset(); toast('Password changed'); }
    });
  };

  // ------------------------------------------------------------ Backup + feed log (Kevin)
  const ALL_KEYS = ['members', 'tasks', 'attention', 'briefs', 'camplife', 'camplife_bal', 'drawers', 'timecards', 'fixes', 'close', 'payroll', 'schedule', 'charges', 'answers', 'lists', 'golf', 'kdocs', 'ckevin', 'setup', 'runs'];
  A.titles.backup = 'Backup';
  A.views.backup = function () {
    if (!A.ensure(['runs'])) return A.loading();
    return `<h1>Backup and feed log</h1>
      <section class="card"><p class="small">The morning feed copies everything people enter here (answers, fixes, payroll asks and photos, schedule, close, tasks) to the OneDrive backup folder each night. You can also download a copy now.</p><button class="primary" id="dl">Download JSON backup</button></section>
      <h2>Feed runs</h2><section class="card">${D('runs').length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th class="txt">When</th><th class="txt">Step</th><th class="txt">Result</th></tr></thead><tbody>${D('runs').map((r) => `<tr><td class="txt">${esc(fmtTime(r.at))}</td><td class="txt">${esc(r.kind)}</td><td class="txt wrap">${dot(r.ok ? 'good' : 'crit')} ${esc(r.summary || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">The feed hasn\'t run yet.</div>'}</section>`;
  };
  A.wires.backup = function (root) {
    const b = root.querySelector('#dl'); if (!b) return;
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Preparing…';
      await Promise.all(ALL_KEYS.map((k) => (k in A.state.data ? null : A.load(k))));
      const out = { app: 'jack-pine-lodge', version: A.APP_VERSION, exported_at: new Date().toISOString() };
      ALL_KEYS.forEach((k) => { out[k] = D(k); });
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `jack-pine-lodge-${todayISO()}.json`; document.body.appendChild(a); a.click(); a.remove();
      b.disabled = false; b.textContent = 'Download JSON backup';
    });
  };
})();
