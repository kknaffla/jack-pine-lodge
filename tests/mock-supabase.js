/* Stand-in for supabase-js in the UI test. Serves window.__FIX__ = {me, db} (already filtered
   per role by make_fixtures.py) and keeps writes in memory. */
(function () {
  const FIX = window.__FIX__;
  const DB = FIX.db;
  const me = { id: FIX.me, email: 'test@example.com' };
  const KEYS = { tasks: ['id'], daily_close: ['date'], payroll_asks: ['period_end'], schedule_weeks: ['week_of'], charge_answers: ['charge_id', 'who'],
    charge_setup_notes: ['key'], timecard_fixes: ['id'], charges: ['id'] };
  const listeners = [];
  window.__WRITES__ = [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(16).slice(2));
  function q(table) {
    let op = 'select', payload = null, conflict = null, single = false, lim = null, rng = null;
    const filters = [], orders = [];
    const api = {
      select() { return api; },
      eq(k, v) { filters.push((r) => r[k] === v); return api; },
      neq(k, v) { filters.push((r) => r[k] !== v); return api; },
      gte(k, v) { filters.push((r) => r[k] != null && String(r[k]) >= String(v)); return api; },
      lte(k, v) { filters.push((r) => r[k] != null && String(r[k]) <= String(v)); return api; },
      in(k, vs) { filters.push((r) => vs.includes(r[k])); return api; },
      order(k, o) { orders.push([k, !(o && o.ascending === false)]); return api; },
      limit(n) { lim = n; return api; },
      range(a, b) { rng = [a, b]; return api; },
      maybeSingle() { single = true; return api; },
      insert(r) { op = 'insert'; payload = r; return api; },
      update(r) { op = 'update'; payload = r; return api; },
      upsert(r, o) { op = 'upsert'; payload = r; conflict = (o && o.onConflict) ? o.onConflict.split(',') : (KEYS[table] || ['id']); return api; },
      delete() { op = 'delete'; return api; },
      then(res, rej) {
        const rows = DB[table] = DB[table] || [];
        const match = (r) => filters.every((f) => f(r));
        const stamp = (r) => Object.assign(r, { updated_at: new Date().toISOString(), updated_by: me.id });
        let data = null;
        if (op === 'select') {
          data = clone(rows.filter(match));
          orders.slice().reverse().forEach(([k, asc]) => data.sort((a, b) => (String(a[k] ?? '') < String(b[k] ?? '') ? -1 : String(a[k] ?? '') > String(b[k] ?? '') ? 1 : 0) * (asc ? 1 : -1)));
          if (rng) data = data.slice(rng[0], rng[1] + 1);
          if (lim != null) data = data.slice(0, lim);
          if (single) data = data[0] || null;
        } else {
          window.__WRITES__.push({ table, op, payload: clone(payload) });
          if (op === 'insert') {
            data = [].concat(payload).map((p) => { const r = stamp(Object.assign({}, p)); if (!r.id && (table === 'tasks' || table === 'timecard_fixes')) r.id = uuid(); if (table === 'tasks') { r.status = r.status || 'open'; r.created = r.created || new Date().toISOString(); } if (table === 'timecard_fixes') { r.status = r.status || 'pending'; r.created_at = new Date().toISOString(); r.created_by = me.id; } rows.push(r); return clone(r); });
          }
          if (op === 'update') data = rows.filter(match).map((r) => clone(stamp(Object.assign(r, payload))));
          if (op === 'upsert') {
            data = [].concat(payload).map((p) => {
              const r = rows.find((x) => conflict.every((k) => x[k] === p[k]));
              if (r) return clone(stamp(Object.assign(r, p)));
              const n = stamp(Object.assign({}, p)); rows.push(n); return clone(n);
            });
          }
          if (op === 'delete') { DB[table] = rows.filter((r) => !match(r)); data = []; }
        }
        return Promise.resolve({ data, error: null }).then(res, rej);
      }
    };
    return api;
  }
  window.supabase = { createClient() { return {
    from: q,
    storage: { from() { return {
      async upload(path, file) { (window.__FILES__ = window.__FILES__ || {})[path] = file; return { data: { path }, error: null }; },
      async createSignedUrl(path) { const f = (window.__FILES__ || {})[path]; return { data: { signedUrl: f ? URL.createObjectURL(f) : 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }, error: null }; }
    }; } },
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', window.__LOGGED_IN__ ? { user: me } : null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword() { listeners.forEach((cb) => cb('SIGNED_IN', { user: me })); return { error: null }; },
      async signOut() { listeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
      async resetPasswordForEmail() { return { error: null }; }, async updateUser() { return { error: null }; }
    },
    channel() { const c = { on() { return c; }, subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 0); return c; } }; return c; },
    removeChannel() {}
  }; } };
})();
