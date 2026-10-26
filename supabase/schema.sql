-- =====================================================================
-- Jack Pine Lodge app: database schema + who-sees-what rules
-- Run in Supabase: SQL Editor → New query → paste → Run. Safe to re-run.
--
-- Roles (public.members.role):
--   kevin  sees and changes everything
--   nick   GM: his desk (drawer, close, timecard fixes, schedule, payroll ask,
--          his tasks), sales without CampLife money and tips, hours (never pay),
--          CampLife arrivals/departures/owing, his attention items, the GM
--          brief, Performance, golf course spend, his card charges and the
--          ones Kevin hands him
--   pete   his card charges, the ones handed to him, golf course spend
--   feed   the morning script on Kevin's Mac: writes the feed tables, reads
--          everyone's answers to export them and to back them up
-- Nobody can add or change members from the app. Janet has no login.
-- Pay amounts and rates are never stored here.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+, so no extension is needed.

-- ---------------------------------------------------------------------
-- Members: the ONLY accounts that can see or change anything.
-- Added by Kevin in the SQL Editor (README step 6).
-- ---------------------------------------------------------------------
create table if not exists public.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role         text not null check (role in ('kevin','nick','pete','feed')),
  created_at   timestamptz not null default now()
);

create or replace function public.app_role()
returns text
language sql stable security definer set search_path = public
as $$ select role from public.members where user_id = auth.uid() $$;

-- Square categories Nick doesn't see: CampLife money rung in Square, and tips.
create or replace function public.hidden_category(c text)
returns boolean language sql immutable
as $$ select coalesce(c, '') in ('Cabin', 'Campground Fee', 'Kitchen Tips') $$;

create or replace function public.stamp_row()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Feed tables: written by the morning script from the files the morning
-- run produces. Never QuickBooks or Square from here.
-- ---------------------------------------------------------------------

-- Net sales by calendar day, location and Square category (Jack Pine locations only).
create table if not exists public.sales_daily (
  day        date not null,
  location   text not null,
  category   text not null,
  net_sales  numeric(12,2) not null,
  as_of      timestamptz,
  primary key (day, location, category)
);

-- Net sales by month, location, category and item (Performance drill-down).
create table if not exists public.sales_items_monthly (
  month      text not null check (month ~ '^\d{4}-\d{2}$'),
  location   text not null,
  category   text not null,
  item       text not null default '',
  net_sales  numeric(12,2) not null,
  as_of      timestamptz,
  primary key (month, location, category, item)
);

-- Square category -> sales tax line (from the bookkeeping tool's mapping).
create table if not exists public.sales_categories (
  category   text primary key,
  line       text not null,
  treatment  text not null,
  sort       int  not null default 100
);

-- Square cash drawer shifts, newest first on screen.
create table if not exists public.drawer_shifts (
  id          text primary key,
  date        date not null,
  state       text,
  closed_by   text,
  start_cash  numeric(10,2),
  cash_in     numeric(10,2),
  paid_in     numeric(10,2),
  paid_out    numeric(10,2),
  expected    numeric(10,2),
  counted     numeric(10,2),
  over_short  numeric(10,2),
  as_of       timestamptz
);

-- Square timecards, last two weeks. Hours only: no wage, tips or pay.
create table if not exists public.timecards (
  shift_id   text primary key,
  tm         text,
  name       text not null,
  job        text,
  in_at      timestamp not null,
  out_at     timestamp,
  hours      numeric(6,2),
  auto       boolean not null default false,
  flag       text,
  flag_text  text,
  as_of      timestamptz
);

-- Payroll hours by payslip line, hours only (no amounts, gross or rates).
create table if not exists public.payroll_hours (
  payslip_id   text not null,
  pay_type     text not null,
  employee     text not null,
  pay_date     date,
  period_begin date,
  period_end   date,
  hours        numeric(8,2),
  as_of        timestamptz,
  primary key (payslip_id, pay_type)
);

-- CampLife: who arrives, who leaves, who owes. Tracking only.
create table if not exists public.camplife_days (
  date        date primary key,
  arrivals    jsonb not null default '[]'::jsonb,
  departures  jsonb not null default '[]'::jsonb,
  owing       jsonb not null default '[]'::jsonb,
  note        text,
  as_of       timestamptz
);
-- CampLife balances are Kevin's only.
create table if not exists public.camplife_balances (
  date                        date primary key,
  advance_deposit_balance     numeric(12,2),
  future_reservation_total    numeric(12,2),
  future_reservation_balance  numeric(12,2),
  as_of                       timestamptz
);

-- Golf course spend, totals only (never item rows from Kevin's cards).
create table if not exists public.golf_spend (
  month    text not null,
  measure  text not null,
  label    text,
  amount   numeric(12,2) not null,
  items    int,
  as_of    timestamptz,
  primary key (month, measure)
);

-- What needs attention (from `jpl attention`): audience kevin or nick.
create table if not exists public.attention_items (
  audience  text not null check (audience in ('kevin','nick')),
  key       text not null,
  label     text not null,
  count     int,
  level     text check (level in ('crit','warn','wait','good')),
  link      text,
  as_of     timestamptz,
  primary key (audience, key)
);

-- Monday brief: Kevin's copy and the GM copy (no money).
create table if not exists public.briefs (
  week_start  date not null,
  audience    text not null check (audience in ('kevin','gm')),
  written_at  timestamptz,
  data        jsonb not null,
  primary key (week_start, audience)
);

-- Kevin-only documents: bank balances (tiles), card alerts, statement checks,
-- job status, bills owed. One JSON document per key.
create table if not exists public.kevin_docs (
  key   text primary key,
  data  jsonb not null,
  at    timestamptz not null default now()
);

-- Pick lists everyone with charges needs: accounts, classes, vehicles.
create table if not exists public.app_lists (
  key   text primary key,
  data  jsonb not null,
  at    timestamptz not null default now()
);

-- Card charges (the bank-feed worklist, rows QuickBooks added, rows posted this year).
-- holder = whose card; handed_to = Kevin gave the row to Nick or Pete.
create table if not exists public.charges (
  id            text primary key,
  src           text,
  card          text,
  holder        text check (holder in ('kevin','nick','pete','janet')),
  handed_to     text check (handed_to in ('nick','pete')),
  handoff_at    timestamptz,               -- set when Kevin hands it off in the app
  date          date,
  descr         text,
  payee         text,
  suggest       text,
  amt_cents     bigint,
  action        text,                      -- POST ASK AMAZON CHECK TRANSFER MATCH EXCLUDE POSTED
  account       text,
  cls           text,
  golf          boolean not null default false,
  conf          int,
  question      text,
  tool_note     text,
  qbo           text,
  qbo_coding    text,
  posted_at     timestamptz,
  held_text     text,                      -- wording safe for the cardholder
  holder_answer jsonb,                     -- latest cardholder answer from the old pages
  active        boolean not null default true,
  as_of         timestamptz,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);
create index if not exists charges_holder on public.charges (holder);
create index if not exists charges_handed on public.charges (handed_to);

-- Kevin-only side of a charge: the tool's hold reason, Kevin's own answer on the old pages.
create table if not exists public.charge_kevin (
  charge_id     text primary key references public.charges(id) on delete cascade,
  held_reason   text,
  kevin_answer  jsonb,
  as_of         timestamptz
);

-- Kevin's setup notes on charges (card names, checks, bank feeds, anything else).
create table if not exists public.charge_setup_notes (
  key         text primary key,
  text        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create or replace function public.can_see_charge(cid text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.charges c
     where c.id = cid
       and (public.app_role() in ('kevin','feed')
            or (public.app_role() in ('nick','pete')
                and c.action in ('POST','ASK','AMAZON','POSTED')
                and (c.holder = public.app_role() or c.handed_to = public.app_role()))));
$$;

-- ---------------------------------------------------------------------
-- What people enter in the app
-- ---------------------------------------------------------------------

-- One answer per charge per person. Nick and Pete answer only rows they can see.
create table if not exists public.charge_answers (
  charge_id   text not null references public.charges(id) on delete cascade,
  who         text not null check (who in ('kevin','nick','pete')),
  status      text not null default 'open' check (status in ('open','ok','skip','edited')),
  account     text,
  cls         text,
  golf        boolean not null default false,
  note        text check (char_length(note) <= 500),
  vehicle     text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (charge_id, who)
);

-- Timecard fix requests. Nick asks; Kevin applies them in Square and marks them.
create table if not exists public.timecard_fixes (
  id          uuid primary key default gen_random_uuid(),
  shift_id    text,
  tm          text,
  name        text not null,
  in_at       timestamp not null,
  out_old     timestamp,
  out_new     timestamp not null,
  hours_old   numeric(6,2),
  status      text not null default 'pending' check (status in ('pending','applied','rejected')),
  note        text check (char_length(note) <= 300),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  applied_at  timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  check (out_new > in_at)
);

-- Next week's schedule, built from last week's timecards. Kevin sends it to Square.
create table if not exists public.schedule_weeks (
  week_of     date primary key,
  status      text not null default 'draft' check (status in ('draft','ready','sent')),
  shifts      jsonb not null default '[]'::jsonb,
  sent_at     timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- The payroll ask: Angel's hours and a photo of Jeff's board, per pay period.
-- Pieces are a count; the app never stores what anyone is paid.
create table if not exists public.payroll_asks (
  period_end    date primary key,
  period_start  date not null,
  angel_hours   numeric(6,2) check (angel_hours between 0 and 200),
  jeff_pieces   int check (jeff_pieces between 0 and 5000),
  board_erased  boolean not null default false,
  photo_path    text,
  note          text check (char_length(note) <= 300),
  sent_at       timestamptz,
  sent_by       uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

-- Daily close checklist.
create table if not exists public.daily_close (
  date         date primary key,
  items        jsonb not null default '{}'::jsonb,
  drawer_note  text check (char_length(drawer_note) <= 300),
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

-- Tasks. who = whose task. Nick sees and changes only his own.
create table if not exists public.tasks (
  id          text primary key default replace(gen_random_uuid()::text, '-', ''),
  title       text not null check (char_length(title) <= 200),
  detail      text check (char_length(detail) <= 1000),
  status      text not null default 'open' check (status in ('open','done')),
  link        text,
  who         text not null default 'kevin' check (who in ('kevin','nick','pete')),
  source      text not null default 'app',
  created     timestamptz not null default now(),
  done_at     timestamptz,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Each feed run leaves one line (Kevin sees it on Home).
create table if not exists public.feed_runs (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  kind     text not null,
  ok       boolean not null,
  summary  text
);

-- ---------------------------------------------------------------------
-- Who changed it, when (server-side)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['charges','charge_setup_notes','charge_answers','timecard_fixes','schedule_weeks',
                           'payroll_asks','daily_close','tasks'] loop
    execute format('drop trigger if exists stamp_%1$s on public.%1$s', t);
    execute format('create trigger stamp_%1$s before insert or update on public.%1$s
                    for each row execute function public.stamp_row()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: enforced by the database, not the UI.
-- An account that is not in members sees nothing and changes nothing.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['members','sales_daily','sales_items_monthly','sales_categories','drawer_shifts','timecards',
                           'payroll_hours','camplife_days','camplife_balances','golf_spend','attention_items','briefs',
                           'kevin_docs','app_lists','charges','charge_kevin','charge_setup_notes','charge_answers',
                           'timecard_fixes','schedule_weeks','payroll_asks','daily_close','tasks','feed_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Drop every policy on these tables so a re-run leaves exactly the ones below.
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- members: everyone sees their own row; Kevin sees all. No one inserts from the app.
create policy members_read on public.members for select to authenticated
  using (user_id = auth.uid() or (select public.app_role()) = 'kevin');
grant select on public.members to authenticated;

-- Feed tables: Kevin and the feed read and write; Nick and Pete read what the table says.
do $$
declare t text;
begin
  foreach t in array array['sales_daily','sales_items_monthly','sales_categories','drawer_shifts','timecards','payroll_hours',
                           'camplife_days','camplife_balances','golf_spend','attention_items','briefs','kevin_docs',
                           'app_lists','charges','charge_kevin'] loop
    execute format('create policy owner_feed_all on public.%I for all to authenticated
                    using ((select public.app_role()) in (''kevin'',''feed''))
                    with check ((select public.app_role()) in (''kevin'',''feed''))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create policy nick_read on public.sales_daily for select to authenticated
  using ((select public.app_role()) = 'nick' and not public.hidden_category(category));
create policy nick_read on public.sales_items_monthly for select to authenticated
  using ((select public.app_role()) = 'nick' and not public.hidden_category(category));
create policy nick_read on public.sales_categories for select to authenticated
  using ((select public.app_role()) = 'nick' and not public.hidden_category(category));
create policy nick_read on public.drawer_shifts for select to authenticated
  using ((select public.app_role()) = 'nick');
create policy nick_read on public.timecards for select to authenticated
  using ((select public.app_role()) = 'nick');
create policy nick_read on public.payroll_hours for select to authenticated
  using ((select public.app_role()) = 'nick');
create policy nick_read on public.camplife_days for select to authenticated
  using ((select public.app_role()) = 'nick');
create policy nick_pete_read on public.golf_spend for select to authenticated
  using ((select public.app_role()) in ('nick','pete'));
create policy nick_read on public.attention_items for select to authenticated
  using ((select public.app_role()) = 'nick' and audience = 'nick');
create policy nick_read on public.briefs for select to authenticated
  using ((select public.app_role()) = 'nick' and audience = 'gm');
create policy nick_pete_read on public.app_lists for select to authenticated
  using ((select public.app_role()) in ('nick','pete'));
create policy holder_read on public.charges for select to authenticated
  using ((select public.app_role()) in ('nick','pete')
         and action in ('POST','ASK','AMAZON','POSTED')
         and (holder = (select public.app_role()) or handed_to = (select public.app_role())));

-- Kevin only, plus the feed reads them for the nightly backup.
create policy kevin_all on public.charge_setup_notes for all to authenticated
  using ((select public.app_role()) = 'kevin') with check ((select public.app_role()) = 'kevin');
create policy feed_read on public.charge_setup_notes for select to authenticated
  using ((select public.app_role()) = 'feed');
create policy kevin_read on public.feed_runs for select to authenticated
  using ((select public.app_role()) in ('kevin','feed'));
create policy feed_insert on public.feed_runs for insert to authenticated
  with check ((select public.app_role()) = 'feed');
grant select, insert, update, delete on public.charge_setup_notes to authenticated;
grant select, insert on public.feed_runs to authenticated;
grant usage on sequence public.feed_runs_id_seq to authenticated;

-- Charge answers: Kevin all; Nick and Pete their own answers on rows they can see; the feed reads.
create policy kevin_all on public.charge_answers for all to authenticated
  using ((select public.app_role()) = 'kevin') with check ((select public.app_role()) = 'kevin');
create policy feed_read on public.charge_answers for select to authenticated
  using ((select public.app_role()) = 'feed');
create policy holder_own on public.charge_answers for all to authenticated
  using ((select public.app_role()) in ('nick','pete') and who = (select public.app_role()) and public.can_see_charge(charge_id))
  with check ((select public.app_role()) in ('nick','pete') and who = (select public.app_role()) and public.can_see_charge(charge_id));
grant select, insert, update, delete on public.charge_answers to authenticated;

-- Nick's desk tables: Kevin all; Nick reads and writes; the feed reads (export + backup).
do $$
declare t text;
begin
  foreach t in array array['timecard_fixes','schedule_weeks','payroll_asks','daily_close','tasks'] loop
    execute format('create policy kevin_all on public.%I for all to authenticated
                    using ((select public.app_role()) = ''kevin'') with check ((select public.app_role()) = ''kevin'')', t);
    execute format('create policy feed_read on public.%I for select to authenticated
                    using ((select public.app_role()) = ''feed'')', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create policy nick_rw on public.schedule_weeks for select to authenticated using ((select public.app_role()) = 'nick');
create policy nick_ins on public.schedule_weeks for insert to authenticated with check ((select public.app_role()) = 'nick' and status <> 'sent');
create policy nick_upd on public.schedule_weeks for update to authenticated
  using ((select public.app_role()) = 'nick') with check ((select public.app_role()) = 'nick' and status <> 'sent');

create policy nick_rw on public.payroll_asks for select to authenticated using ((select public.app_role()) = 'nick');
create policy nick_ins on public.payroll_asks for insert to authenticated with check ((select public.app_role()) = 'nick');
create policy nick_upd on public.payroll_asks for update to authenticated
  using ((select public.app_role()) = 'nick') with check ((select public.app_role()) = 'nick');

create policy nick_rw on public.daily_close for select to authenticated using ((select public.app_role()) = 'nick');
create policy nick_ins on public.daily_close for insert to authenticated with check ((select public.app_role()) = 'nick');
create policy nick_upd on public.daily_close for update to authenticated
  using ((select public.app_role()) = 'nick') with check ((select public.app_role()) = 'nick');

-- Timecard fixes: Nick sees all, adds pending ones, changes or withdraws his own while pending.
create policy nick_read on public.timecard_fixes for select to authenticated using ((select public.app_role()) = 'nick');
create policy nick_ins on public.timecard_fixes for insert to authenticated
  with check ((select public.app_role()) = 'nick' and status = 'pending' and created_by = auth.uid() and applied_at is null);
create policy nick_upd on public.timecard_fixes for update to authenticated
  using ((select public.app_role()) = 'nick' and status = 'pending' and created_by = auth.uid())
  with check ((select public.app_role()) = 'nick' and status = 'pending' and created_by = auth.uid() and applied_at is null);
create policy nick_del on public.timecard_fixes for delete to authenticated
  using ((select public.app_role()) = 'nick' and status = 'pending' and created_by = auth.uid());

-- Tasks: Nick only his own, and only ever assigned to himself. The feed adds and syncs tasks.
create policy nick_read on public.tasks for select to authenticated using ((select public.app_role()) = 'nick' and who = 'nick');
create policy nick_ins on public.tasks for insert to authenticated with check ((select public.app_role()) = 'nick' and who = 'nick');
create policy nick_upd on public.tasks for update to authenticated
  using ((select public.app_role()) = 'nick' and who = 'nick') with check ((select public.app_role()) = 'nick' and who = 'nick');
create policy feed_write on public.tasks for insert to authenticated with check ((select public.app_role()) = 'feed');
create policy feed_update on public.tasks for update to authenticated
  using ((select public.app_role()) = 'feed') with check ((select public.app_role()) = 'feed');

-- The feed role reads the user tables above but never inserts, changes or deletes them
-- (tasks excepted). Nobody but Kevin deletes.
-- ---------------------------------------------------------------------
-- Payroll photos: private bucket, Kevin and Nick; the feed reads for the backup.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payroll-photos', 'payroll-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payroll_photos_read on storage.objects;
drop policy if exists payroll_photos_insert on storage.objects;
drop policy if exists payroll_photos_update on storage.objects;
drop policy if exists payroll_photos_delete on storage.objects;
create policy payroll_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'payroll-photos' and (select public.app_role()) in ('kevin','nick','feed'));
create policy payroll_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payroll-photos' and (select public.app_role()) in ('kevin','nick'));
create policy payroll_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'payroll-photos' and (select public.app_role()) in ('kevin','nick'))
  with check (bucket_id = 'payroll-photos' and (select public.app_role()) in ('kevin','nick'));
create policy payroll_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payroll-photos' and (select public.app_role()) = 'kevin');

-- ---------------------------------------------------------------------
-- Functions callable from the app
-- ---------------------------------------------------------------------
revoke all on function public.app_role() from public, anon;
grant execute on function public.app_role() to authenticated;
revoke all on function public.can_see_charge(text) from public, anon;
grant execute on function public.can_see_charge(text) to authenticated;

-- ---------------------------------------------------------------------
-- Live sync between devices
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['tasks','charge_answers','timecard_fixes','schedule_weeks','payroll_asks','daily_close','charges','feed_runs'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
