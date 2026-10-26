# CLAUDE.md: Jack Pine Lodge app

Claude Code reads this file automatically.

## What this is
One web app for Jack Pine Lodge (lodge, cabins, campground, kitchen, golf course) replacing the claude.ai pages: Nick's desk and card charges (stage 1), Pete's card charges and Kevin's Launch Pad, Feed Review and Performance (stage 2). Plan: https://claude.ai/artifact/SiRhvRfoL2gDtcsWik5bcr. Built like Lily's app in `~/Projects/college-plan`.
- Kevin (owner) is a career CFO: few words, real numbers. Do the literal ask; offer anything extra.
- The old pages keep running until Kevin retires them page by page. Deleting anything needs Kevin's yes.
- No QuickBooks or Square writes, ever, from here. Recodes wait for Kevin's yes in the bookkeeping session.

## Architecture
- `site/`: static single-page app, no build. `index.html`, `app.js` (core: helpers, data loaders, sign-in, roles, nav), `views-desk.js` (Today, Timecards + schedule, Payroll ask), `views-charges.js` (Charges for Nick/Pete, Cards review for Kevin), `views-kevin.js` (Home, Performance, Golf, More, Backup), `styles.css`, `config.js`, manifest, icons. supabase-js 2.117.2 UMD from jsdelivr.
  - `config.js` holds the Supabase URL and the **publishable** key. Never the secret / service_role key, anywhere.
- `supabase/schema.sql`: every table, RLS policy, the `payroll-photos` bucket, realtime. Idempotent; drops and recreates every policy. Roles in `members.role`: kevin, nick, pete, feed. `app_role()` and `can_see_charge()` are security definer. `hidden_category()` = Cabin, Campground Fee, Kitchen Tips (Nick never gets them). `stamp_row()` sets updated_at/updated_by.
  - Feed tables (feed + Kevin write; others read per policy): sales_daily, sales_items_monthly, sales_categories, drawer_shifts, timecards, payroll_hours, camplife_days, camplife_balances (Kevin only), golf_spend, attention_items (audience kevin|nick), briefs (kevin|gm), kevin_docs (Kevin only: tiles, alerts, statements, jobs), app_lists, charges, charge_kevin (Kevin only: hold reasons, Kevin's page answers).
  - People's tables: charge_answers (PK charge_id+who), timecard_fixes, schedule_weeks, payroll_asks, daily_close, tasks, charge_setup_notes (Kevin only). The feed reads these (export + backup) and writes none, except tasks.
  - Pay amounts and rates are never stored. Payroll hours and timecards are hours only; `jpl_feed.py` refuses money keys.
- Charges: `holder` from the card's last four (CARDS in app.js and jpl_feed.py, same as the bookkeeping tool); `handed_to` from Kevin's 'who' answers or his in-app hand-off (`handoff_at` set = the app's wins). Who codes a row (`responsible`) = handed_to, else Nick/Pete for their cards, else Kevin (Janet, shared, checking). Counts match `jpl feed-count` (checked Oct 26 on real files: Nick 118/118 done, Pete 51/51) and Kevin's "need an answer" matches `jpl attention` (172).
- `feed/jpl_feed.py` (stdlib only; PyYAML if present): `push`, `export`, `backup`, `check`. Signs in as the feed login (refuses any other role and any secret key). Settings in `feed/feed.env` (gitignored). Reads `~/Bookkeeping` files and `~/Bookkeeping/data/feed/app/in/*.json` (copies the Claude morning runs save); writes `data/feed/app/answers/<who>/items/` and `data/feed/app/out/`. Never edit `~/Bookkeeping` code or the scheduled tasks from here: hand commands to the session that owns them.
- **Hosting:** GitHub Pages from the `gh-pages` branch (only `site/`), repo `kknaffla/jack-pine-lodge` (public, so: code only, no data, no real fixtures). Deploy: `git push origin main && git subtree push --prefix site origin gh-pages`. gh CLI at `~/.local/bin/gh` (no `workflow` scope: no Actions).
- **Dates:** America/Detroit. Square reporting_day labels run a day early; the morning run already shifts them, so files arriving here are calendar days. Pay periods end every other Sunday; the app's payroll ask starts with the period ending `PAY_FIRST_END` (2026-11-08) in config.js.
- **Appearance:** per-device Auto/Light/Dark (localStorage 'theme', inline script in index.html). Dark rules exist under both `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`.

## Commands
- DB rules locally: `PSQL="psql -h 127.0.0.1 -p 54329 -U postgres" tests/rls.sh` (needs a throwaway Postgres; on this Mac a pip `pgserver` copy lives in the session scratchpad). After changing rls-test.sql, run `python3 tests/make_rls_live.py` to refresh `tests/rls-live.sql` (the SQL Editor version).
- UI: `python3 tests/make_fixtures.py && .venv-test/bin/python tests/ui_test.py` (Python Playwright; setup line in the file). No Node on this Mac.
- Feed dry run on real files: `python3 feed/jpl_feed.py check --out <folder outside the repo>`.

## Conventions
- Vanilla JS, no framework, no build. Escape all text with `esc()`; only http(s) links via `safeUrl()`.
- Schema changes: new `supabase/migrations/NNN_description.sql`, idempotent; update `schema.sql`, `rls-test.sql` and regenerate `rls-live.sql`.
- Before each deploy bump `APP_VERSION` in `site/app.js` and every `?v=` tag in `site/index.html`.
- Commit messages: short and imperative.

## Status (Oct 26, 2026)
- ✅ Supabase org "Jack Pine Lodge" (Free), project `jack-pine-lodge` (East US, ref aizbhzikpniaevcynhxw). Sign-ups off; Data API on, tables not auto-exposed, automatic RLS on; Site URL = the Pages address.
- ✅ Schema + rules: 132 checks pass locally and on the live project (Oct 26). Signed-out requests get 401 on every table.
- ✅ Logins: Kevin (kevin), the feed (kknaffla+jplfeed@gmail.com, role feed; password only in feed/feed.env), Nick (nick). Pete: none yet (Kevin codes Pete's cards for now).
- ✅ Feed live: push, export, backup and stage all run on real files (1,028 charges, 3,697 sales day×category rows, timecards, drawers, briefs, launch pad tasks). Second push is idempotent.
- ✅ Screens for Kevin pass on real data; headless tests 104 pass at 390/1280 px. Reopening while signed in works (fixed Oct 26: SIGNED_IN + INITIAL_SESSION started the app twice).
- ⬜ Morning runs wired (commands sent to session local_c863bd6b Oct 26; Kevin approves the edits and the permission entry). Until then the app's data is only as fresh as the last manual push.
- Note: Supabase's built-in email reaches only the org's members (Kevin). Nick and Pete change passwords in More → Change password.
