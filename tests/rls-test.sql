-- Who-sees-what test. Run on a throwaway local Postgres after db-stub.sql and schema.sql:
--   psql -v ON_ERROR_STOP=1 -f tests/db-stub.sql -f supabase/schema.sql -f tests/rls-test.sql
-- Every line prints PASS or FAIL; the last statement raises an error if anything failed.
-- All data here is made up.
\set QUIET on
create schema if not exists t;
create table if not exists t.results (n serial, label text, ok boolean, detail text);
grant usage on schema t to public;
create or replace function t.check(label text, ok boolean, detail text default null) returns void
language sql security definer as $$ insert into t.results (label, ok, detail) values (label, coalesce(ok, false), detail) $$;
-- rows the caller gets back from a query (select count, or "with x as (update ... returning 1) select count(*) from x")
create or replace function t.rows(label text, q text, expected int) returns void
language plpgsql security invoker as $$
declare n int;
begin
  begin execute q into n;
  exception when others then perform t.check(label, false, 'error: ' || sqlerrm); return; end;
  perform t.check(label, n = expected, 'got ' || n || ', expected ' || expected);
end $$;
-- a statement the caller must not be able to run
create or replace function t.fails(label text, q text) returns void
language plpgsql security invoker as $$
begin
  begin execute q;
  exception when others then perform t.check(label, true, sqlerrm); return; end;
  perform t.check(label, false, 'statement was allowed');
end $$;
-- a statement the caller must be able to run
create or replace function t.works(label text, q text) returns void
language plpgsql security invoker as $$
begin
  begin execute q;
  exception when others then perform t.check(label, false, 'error: ' || sqlerrm); return; end;
  perform t.check(label, true);
end $$;
grant execute on all functions in schema t to public;

-- ---------- people ----------
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111','kevin@test'), ('22222222-2222-2222-2222-222222222222','nick@test'),
  ('33333333-3333-3333-3333-333333333333','pete@test'),  ('44444444-4444-4444-4444-444444444444','feed@test'),
  ('55555555-5555-5555-5555-555555555555','stranger@test') on conflict do nothing;
insert into members values
  ('11111111-1111-1111-1111-111111111111','Kevin','kevin'), ('22222222-2222-2222-2222-222222222222','Nick','nick'),
  ('33333333-3333-3333-3333-333333333333','Pete','pete'),   ('44444444-4444-4444-4444-444444444444','Morning feed','feed')
  on conflict do nothing;

-- ---------- made-up data, one or two rows per table ----------
insert into sales_daily values ('2026-10-20','Jack Pine Lodge','Food, Burgers',100,now()), ('2026-10-20','Jack Pine Lodge','Cabin',200,now()),
  ('2026-10-20','Jack Pine Lodge','Campground Fee',30,now()), ('2026-10-20','Jack Pine Lodge','Kitchen Tips',5,now());
insert into sales_items_monthly values ('2026-10','Jack Pine Lodge','Food, Burgers','Burger',100,now()), ('2026-10','Jack Pine Lodge','Cabin','Cabin 1',200,now());
insert into sales_categories values ('Food, Burgers','Food','income',1), ('Cabin','Cabins','camplife',90), ('Kitchen Tips','Tips','tips',95);
insert into drawer_shifts values ('d1','2026-10-20','CLOSED','Server A',100,50,0,10,140,140,0,now());
insert into timecards values ('s1','tm1','Server A','Server','2026-10-20 11:00','2026-10-20 19:00',8,false,null,null,now());
insert into payroll_hours values ('ps1','Hourly','Server A','2026-10-23','2026-10-06','2026-10-19',40,now());
insert into camplife_days values ('2026-10-20','[{"name":"Guest A","site":"12"}]','[]','[]','test',now());
insert into camplife_balances values ('2026-10-20',1000,2000,500,now());
insert into golf_spend values ('2026-10','golf_uncoded','Golf spend uncoded',1234.5,3,now());
insert into attention_items values ('kevin','cards-duplicates','possible double charges',2,'crit','quickbooks',now()),
                                   ('nick','cards-held','your charges held',1,'warn','charges',now());
insert into briefs values ('2026-10-19','kevin',now(),'{"cash":{"checking":1}}'), ('2026-10-19','gm',now(),'{"summary":"ok"}');
insert into kevin_docs values ('tiles','{"checking":1}',now());
insert into app_lists values ('accounts','["Food Purchases"]',now());
insert into charges (id, holder, handed_to, action, amt_cents, descr) values
  ('k1','kevin',null,'POST',-100,'kevin card'), ('j1','janet',null,'POST',-100,'janet card'),
  ('n1','nick',null,'POST',-100,'nick card'),   ('n2','nick',null,'TRANSFER',-100,'nick transfer'),
  ('p1','pete',null,'POST',-100,'pete card'),   ('k2','kevin','nick','POST',-100,'handed to nick'),
  ('k3','kevin','pete','ASK',-100,'handed to pete');
insert into charge_kevin values ('n1','differs from Kevin','{"account":"x"}',now());
insert into charge_setup_notes (key, text) values ('extra','setup note');
insert into charge_answers (charge_id, who, status, account) values ('k2','kevin','ok','Food Purchases'), ('n1','nick','ok','Food Purchases'), ('p1','pete','ok','Repairs and Maintenance');
insert into timecard_fixes (id, name, in_at, out_new, created_by) values ('aaaaaaaa-0000-4000-a000-000000000001','Server A','2026-10-20 11:00','2026-10-20 19:00','22222222-2222-2222-2222-222222222222');
insert into schedule_weeks (week_of) values ('2026-11-02');
insert into payroll_asks (period_end, period_start, angel_hours) values ('2026-11-08','2026-10-26',10);
insert into daily_close (date) values ('2026-10-20');
insert into tasks (id, title, who) values ('tk','Kevin task','kevin'), ('tn','Nick task','nick'), ('tp','Pete task','pete');
insert into feed_runs (kind, ok, summary) values ('push', true, 'test');
insert into storage.objects (bucket_id, name) values ('payroll-photos','2026-11-08/board.jpg');

-- ---------- a signed-in account that is not a member ----------
set role authenticated; set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$
declare tb text;
begin
  foreach tb in array array['members','sales_daily','sales_items_monthly','sales_categories','drawer_shifts','timecards','payroll_hours',
    'camplife_days','camplife_balances','golf_spend','attention_items','briefs','kevin_docs','app_lists','charges','charge_kevin',
    'charge_setup_notes','charge_answers','timecard_fixes','schedule_weeks','payroll_asks','daily_close','tasks','feed_runs'] loop
    perform t.rows('stranger sees 0 rows in ' || tb, format('select count(*) from public.%I', tb), 0);
  end loop;
end $$;
select t.rows('stranger sees 0 payroll photos', $q$select count(*) from storage.objects$q$, 0);
select t.rows('stranger updates 0 tasks', $q$with x as (update tasks set status='done' returning 1) select count(*) from x$q$, 0);
select t.rows('stranger deletes 0 charges', $q$with x as (delete from charges returning 1) select count(*) from x$q$, 0);
select t.fails('stranger cannot add a task', $q$insert into tasks (title, who) values ('x','nick')$q$);
select t.fails('stranger cannot add himself as a member', $q$insert into members values ('55555555-5555-5555-5555-555555555555','x','kevin')$q$);
reset role;

-- ---------- signed out ----------
set role anon;
select t.fails('anon is denied charges', $q$select count(*) from charges$q$);
select t.fails('anon is denied sales', $q$select count(*) from sales_daily$q$);
select t.fails('anon is denied members', $q$select count(*) from members$q$);
reset role;

-- ---------- Nick ----------
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select t.rows('nick: sales without Cabin, Campground Fee, Kitchen Tips', $q$select count(*) from sales_daily$q$, 1);
select t.rows('nick: no hidden categories in items', $q$select count(*) from sales_items_monthly where public.hidden_category(category)$q$, 0);
select t.rows('nick: category map without hidden ones', $q$select count(*) from sales_categories$q$, 1);
select t.rows('nick sees drawer shifts', $q$select count(*) from drawer_shifts$q$, 1);
select t.rows('nick sees timecards', $q$select count(*) from timecards$q$, 1);
select t.rows('nick sees payroll hours', $q$select count(*) from payroll_hours$q$, 1);
select t.rows('nick sees CampLife days', $q$select count(*) from camplife_days$q$, 1);
select t.rows('nick: no CampLife balances', $q$select count(*) from camplife_balances$q$, 0);
select t.rows('nick sees golf spend', $q$select count(*) from golf_spend$q$, 1);
select t.rows('nick: only his attention items', $q$select count(*) from attention_items$q$, 1);
select t.rows('nick: only the GM brief', $q$select count(*) from briefs where audience = 'gm'$q$, 1);
select t.rows('nick: no Kevin brief', $q$select count(*) from briefs where audience = 'kevin'$q$, 0);
select t.rows('nick: no bank balances or alerts', $q$select count(*) from kevin_docs$q$, 0);
select t.rows('nick sees pick lists', $q$select count(*) from app_lists$q$, 1);
select t.rows('nick: his card + handed to him only', $q$select count(*) from charges$q$, 2);
select t.rows('nick: not Pete''s card', $q$select count(*) from charges where holder = 'pete'$q$, 0);
select t.rows('nick: not Kevin''s cards (unless handed)', $q$select count(*) from charges where holder = 'kevin' and handed_to is distinct from 'nick'$q$, 0);
select t.rows('nick: not Janet''s cards', $q$select count(*) from charges where holder = 'janet'$q$, 0);
select t.rows('nick: no hold reasons / Kevin answers', $q$select count(*) from charge_kevin$q$, 0);
select t.rows('nick: no Kevin setup notes', $q$select count(*) from charge_setup_notes$q$, 0);
select t.rows('nick: only his own answers', $q$select count(*) from charge_answers$q$, 1);
select t.rows('nick: not Kevin''s answer on a row handed to him', $q$select count(*) from charge_answers where who = 'kevin'$q$, 0);
select t.rows('nick: no feed runs', $q$select count(*) from feed_runs$q$, 0);
select t.rows('nick: sees only himself in members', $q$select count(*) from members$q$, 1);
select t.works('nick answers a row handed to him', $q$insert into charge_answers (charge_id, who, status, account) values ('k2','nick','ok','Food Purchases')$q$);
select t.fails('nick cannot answer Pete''s row', $q$insert into charge_answers (charge_id, who, status) values ('p1','nick','ok')$q$);
select t.fails('nick cannot answer as Kevin', $q$insert into charge_answers (charge_id, who, status) values ('n1','kevin','ok')$q$);
select t.fails('nick cannot answer his transfer row', $q$insert into charge_answers (charge_id, who, status) values ('n2','nick','ok')$q$);
select t.rows('nick changes 0 charge rows', $q$with x as (update charges set account = 'x' returning 1) select count(*) from x$q$, 0);
select t.rows('nick changes 0 of Pete''s answers', $q$with x as (update charge_answers set note = 'x' where who = 'pete' returning 1) select count(*) from x$q$, 0);
select t.fails('nick cannot write sales', $q$insert into sales_daily values ('2026-10-21','x','Food',1,now())$q$);
select t.rows('nick: only his tasks', $q$select count(*) from tasks$q$, 1);
select t.works('nick adds his own task', $q$insert into tasks (title, who) values ('mine','nick')$q$);
select t.fails('nick cannot add a task for Kevin', $q$insert into tasks (title, who) values ('x','kevin')$q$);
select t.rows('nick changes 0 Kevin tasks', $q$with x as (update tasks set status = 'done' where who = 'kevin' returning 1) select count(*) from x$q$, 0);
select t.fails('nick cannot hand his task to Pete', $q$update tasks set who = 'pete' where id = 'tn'$q$);
select t.rows('nick deletes 0 tasks', $q$with x as (delete from tasks returning 1) select count(*) from x$q$, 0);
select t.works('nick asks for a timecard fix', $q$insert into timecard_fixes (name, in_at, out_new) values ('Server A','2026-10-21 11:00','2026-10-21 20:00')$q$);
select t.fails('nick cannot mark a fix applied', $q$insert into timecard_fixes (name, in_at, out_new, status) values ('Server A','2026-10-22 11:00','2026-10-22 20:00','applied')$q$);
select t.fails('nick cannot apply his own fix', $q$update timecard_fixes set status = 'applied' where id = 'aaaaaaaa-0000-4000-a000-000000000001'$q$);
select t.works('nick sends the payroll ask', $q$insert into payroll_asks (period_end, period_start, angel_hours, jeff_pieces, sent_at) values ('2026-11-22','2026-11-09',12.5,30,now())$q$);
select t.fails('payroll ask refuses impossible hours', $q$insert into payroll_asks (period_end, period_start, angel_hours) values ('2026-12-06','2026-11-23',900)$q$);
select t.works('nick ticks the daily close', $q$insert into daily_close (date, items) values ('2026-10-21','{"drawer":{"done":true}}') on conflict (date) do update set items = excluded.items$q$);
select t.works('nick drafts a schedule', $q$insert into schedule_weeks (week_of, shifts) values ('2026-11-09','[]')$q$);
select t.fails('nick cannot mark a schedule sent', $q$update schedule_weeks set status = 'sent' where week_of = '2026-11-09'$q$);
select t.rows('nick sees the payroll photo', $q$select count(*) from storage.objects$q$, 1);
select t.fails('nick cannot add a member', $q$insert into members values ('55555555-5555-5555-5555-555555555555','x','nick')$q$);
select t.fails('nick cannot promote himself', $q$update members set role = 'kevin'$q$);
reset role;

-- ---------- Pete ----------
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select t.rows('pete: his card + handed to him only', $q$select count(*) from charges$q$, 2);
select t.rows('pete: not Nick''s card', $q$select count(*) from charges where holder = 'nick'$q$, 0);
select t.rows('pete: only his own answers', $q$select count(*) from charge_answers$q$, 1);
select t.rows('pete sees golf spend', $q$select count(*) from golf_spend$q$, 1);
select t.rows('pete sees pick lists', $q$select count(*) from app_lists$q$, 1);
do $$
declare tb text;
begin
  foreach tb in array array['sales_daily','sales_items_monthly','sales_categories','drawer_shifts','timecards','payroll_hours',
    'camplife_days','camplife_balances','attention_items','briefs','kevin_docs','charge_kevin','charge_setup_notes',
    'timecard_fixes','schedule_weeks','payroll_asks','daily_close','tasks','feed_runs'] loop
    perform t.rows('pete sees 0 rows in ' || tb, format('select count(*) from public.%I', tb), 0);
  end loop;
end $$;
select t.rows('pete sees 0 payroll photos', $q$select count(*) from storage.objects$q$, 0);
select t.works('pete answers a row handed to him', $q$insert into charge_answers (charge_id, who, status, account) values ('k3','pete','ok','Repairs and Maintenance')$q$);
select t.fails('pete cannot answer Nick''s row', $q$insert into charge_answers (charge_id, who, status) values ('n1','pete','ok')$q$);
select t.fails('pete cannot send the payroll ask', $q$insert into payroll_asks (period_end, period_start, angel_hours) values ('2026-12-20','2026-12-07',1)$q$);
select t.fails('pete cannot add tasks', $q$insert into tasks (title, who) values ('x','pete')$q$);
select t.fails('pete cannot upload a payroll photo', $q$insert into storage.objects (bucket_id, name) values ('payroll-photos','x.jpg')$q$);
select t.fails('pete cannot add a member', $q$insert into members values ('55555555-5555-5555-5555-555555555555','x','pete')$q$);
reset role;

-- ---------- the morning feed ----------
set role authenticated; set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select t.works('feed writes sales', $q$insert into sales_daily values ('2026-10-22','Jack Pine Lodge','Food, Burgers',50,now()) on conflict do nothing$q$);
select t.works('feed writes charges', $q$update charges set held_text = 'Waiting for Kevin' where id = 'n1'$q$);
select t.rows('feed reads every answer', $q$select count(*) from charge_answers$q$, 5);
select t.rows('feed reads fixes for the export', $q$select count(*) from timecard_fixes$q$, 2);
select t.rows('feed reads payroll photos for the backup', $q$select count(*) from storage.objects$q$, 1);
select t.fails('feed cannot answer charges', $q$insert into charge_answers (charge_id, who, status) values ('j1','kevin','ok')$q$);
select t.rows('feed changes 0 payroll asks', $q$with x as (update payroll_asks set angel_hours = 1 returning 1) select count(*) from x$q$, 0);
select t.rows('feed deletes 0 daily closes', $q$with x as (delete from daily_close returning 1) select count(*) from x$q$, 0);
select t.fails('feed cannot add a member', $q$insert into members values ('55555555-5555-5555-5555-555555555555','x','kevin')$q$);
select t.fails('feed cannot upload photos', $q$insert into storage.objects (bucket_id, name) values ('payroll-photos','x.jpg')$q$);
reset role;

-- ---------- Kevin ----------
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select t.rows('kevin sees every charge', $q$select count(*) from charges$q$, 7);
select t.rows('kevin sees every sales row', $q$select count(*) from sales_daily$q$, 5);
select t.rows('kevin sees every answer', $q$select count(*) from charge_answers$q$, 5);
select t.rows('kevin sees every member', $q$select count(*) from members$q$, 4);
select t.rows('kevin sees bank balances', $q$select count(*) from kevin_docs$q$, 1);
select t.rows('kevin sees all tasks', $q$select count(*) from tasks$q$, 4);
select t.works('kevin hands a charge to Pete', $q$update charges set handed_to = 'pete', handoff_at = now() where id = 'k1'$q$);
select t.works('kevin applies a fix', $q$update timecard_fixes set status = 'applied', applied_at = now() where id = 'aaaaaaaa-0000-4000-a000-000000000001'$q$);
select t.rows('a change is stamped with who made it', $q$select count(*) from timecard_fixes where id = 'aaaaaaaa-0000-4000-a000-000000000001' and updated_by = '11111111-1111-1111-1111-111111111111'$q$, 1);
select t.fails('kevin cannot add a member from the app', $q$insert into members values ('55555555-5555-5555-5555-555555555555','x','kevin')$q$);
reset role;

-- After Kevin's hand-off, Pete sees k1 and Nick still doesn't.
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select t.rows('pete sees the row Kevin just handed him', $q$select count(*) from charges where id = 'k1'$q$, 1);
reset role;

-- ---------- report ----------
\set QUIET off
select case when ok then 'PASS' else 'FAIL' end as result, label, detail from t.results order by n;
do $$
declare bad int; total int;
begin
  select count(*) filter (where not ok), count(*) into bad, total from t.results;
  raise notice '% checks, % failed', total, bad;
  if bad > 0 then raise exception 'RLS test failed'; end if;
end $$;
