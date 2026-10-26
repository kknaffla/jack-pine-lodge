# Jack Pine Lodge app: setup

One private web app for Kevin, Nick (GM) and Pete (golf course). Each signs in with their own login and sees only what the database lets them see. It runs beside the claude.ai pages until Kevin retires them page by page.

- **Website:** plain HTML and JavaScript in `site/`, no build step, hosted free on **GitHub Pages**: https://kknaffla.github.io/jack-pine-lodge/
- **Database and logins:** **Supabase**, Free plan, its own organization "Jack Pine Lodge" (so Lily's project stays free). The SQL is in `supabase/`.
- **Data:** the morning run on Kevin's Mac writes its usual files; `feed/jpl_feed.py` copies them into the app and copies Nick's and Pete's answers back. The app never calls QuickBooks or Square.
- **Security:** the database blocks every account that isn't on the members list, and gives Nick and Pete only their rows. Hiding buttons is not what keeps data private. The publishable key in `site/config.js` is public by design; it reads nothing without a member's login.

## Who sees what

| In the app | Nick | Pete |
|---|---|---|
| Sales by day and category (without Cabin, Campground Fee, Kitchen Tips) | sees | — |
| Cash drawer and daily close | edits | — |
| Timecards: Fix requests (Kevin applies them in Square) | edits | — |
| Weekly schedule (Kevin sends it to Square) | edits | — |
| Labor hours by person (hours only, never pay) | sees | — |
| Payroll ask: Angel's hours, Jeff's board photo | edits | — |
| CampLife arrivals, departures, amounts owed | sees | — |
| Tasks assigned to him | edits | — |
| Items needing attention (his cards only) | sees | — |
| Monday brief, GM copy (no money) | sees | — |
| Performance: sales by tax line, category, item | sees | — |
| Golf course spend (totals) | sees | sees |
| His own card charges, and charges Kevin hands him | edits | edits |
| Kevin's and Janet's cards, card alerts, Kevin's setup notes, bank balances, bills, statement checks | — | — |
| Pay amounts and rates | never stored | never stored |

Kevin sees and changes everything. Janet has no login; her charges stay with Kevin. `tests/rls-test.sql` checks every line of this table.

---

## Part A: Supabase (Kevin, about 20 minutes)

1. **Organization and project.** Sign in at https://supabase.com with your own account (the one Lily's project uses). Create a new organization **Jack Pine Lodge** on the **Free** plan. In it, create the project **jack-pine-lodge**, region **East US**, with a strong database password saved in your password manager (the app never uses it).
2. **Lock it down.** Authentication → Sign In / Providers: turn **Allow new users to sign up** OFF (Email stays on). Turn on two-step sign-in for your Supabase account (Account → Security) and for GitHub (Settings → Password and authentication).
3. **Connection values.** Project Settings → API Keys: copy the **Project URL** and the **publishable** key into `site/config.js` (Claude does this when you send them). Never use the secret key anywhere.
4. **Tables and rules.** SQL Editor → New query → paste all of `supabase/schema.sql` → Run. Expect "Success. No rows returned".
5. **Test the rules on the live project.** New query → paste all of `tests/rls-live.sql` → Run. It ends in a red message on purpose: **"Test finished, nothing saved: 132 checks, 0 failed"**. Anything other than 0 failed: stop and tell Claude.
6. **Logins.** Authentication → Users → Add user → Create new user, with **Auto Confirm User** ticked:
   - you (your usual email);
   - the feed login: a plus-address of your Gmail, e.g. yourname+jplfeed@gmail.com, with a long random password from your password manager;
   - Nick and Pete, only after step 5 passed, each with a temporary password.

   Then in the SQL Editor (edit the emails):
   ```sql
   insert into public.members (user_id, display_name, role)
   select id, 'Kevin', 'kevin' from auth.users where email = 'KEVIN-EMAIL'
   union all select id, 'Morning feed', 'feed' from auth.users where email = 'FEED-EMAIL'
   union all select id, 'Nick', 'nick' from auth.users where email = 'NICK-EMAIL'
   union all select id, 'Pete', 'pete' from auth.users where email = 'PETE-EMAIL'
   on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name;
   select display_name, role from public.members;
   ```
7. **Password-reset links.** Authentication → URL Configuration: Site URL and Redirect URLs = `https://kknaffla.github.io/jack-pine-lodge/`.
8. **The feed's password.** In Terminal on the Mac, type (the password is never shown, never in chat or git):
   ```bash
   cd ~/Projects/jack-pine-lodge && cp feed/feed.env.example feed/feed.env && chmod 600 feed/feed.env && open -e feed/feed.env
   ```
   Fill in SUPABASE_URL, SUPABASE_KEY (publishable), FEED_EMAIL, FEED_PASSWORD and save.

## Part B: Website (done from Claude Code)

Repo `kknaffla/jack-pine-lodge` (public: code only, no data). Pages serves the `gh-pages` branch, which holds only `site/`:
```bash
git push origin main && git subtree push --prefix site origin gh-pages
```

## Part C: The feed

```bash
python3 feed/jpl_feed.py check     # read every input, print counts; no network
python3 feed/jpl_feed.py push      # morning files -> app
python3 feed/jpl_feed.py export    # app answers -> ~/Bookkeeping/data/feed/app/
python3 feed/jpl_feed.py backup    # app data + payroll photos -> BACKUP_DIR/<date>/
```
Inputs: the bookkeeping tool's own files (`data/feed/...`, `data/camplife/...`, `data/status/...`, `jpl attention`) plus copies the Claude morning runs save to `~/Bookkeeping/data/feed/app/in/` (Square sales files, payroll hours, cash drawer, time clock, bank tiles, Monday brief, launch pad tasks). Outputs: answers in `data/feed/app/answers/<kevin|nick|pete>/items/`, which `jpl feed-answers` merges with the pages' answers, and fixes, payroll asks, schedules, tasks and the daily close in `data/feed/app/out/`. The scheduled tasks run these commands; Kevin approves any permission change.

## Part D: Phones

Open the site in Safari, sign in, then Share → Add to Home Screen. Nick and Pete change their temporary password in **More → Change password**. (Forgot password? emails reach only Kevin: Supabase's built-in email sends only to the organization's own members.)

---

## Tests

- **Database rules**, on a throwaway local Postgres:
  `PSQL="psql -h 127.0.0.1 -U postgres" tests/rls.sh` (fresh database, schema twice, 132 checks).
- **Screens**, headless with made-up data, at 390 px and 1280 px for Kevin, Nick and Pete:
  `python3 tests/make_fixtures.py && .venv-test/bin/python tests/ui_test.py` (setup line at the top of `tests/ui_test.py`). Screenshots go to `tests/out/`.

## Troubleshooting

- **"Almost there… hasn't been added"**: the login exists but step 6's members insert wasn't run for that email.
- **"Setup needed"**: `site/config.js` still has the placeholders.
- **"Morning update is late"** on Nick's Today, or **"App feed hasn't run"** on Kevin's Home: the morning run or `jpl_feed.py push` didn't finish; see More → Backup and feed log.
- **The site stops loading after a quiet week**: Supabase Free pauses an unused project. Dashboard → Restore project. Daily use keeps it awake.
