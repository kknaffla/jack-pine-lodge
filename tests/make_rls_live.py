"""Builds tests/rls-live.sql from tests/rls-test.sql for the Supabase SQL Editor: the same checks inside one
transaction that always ends in an error, so nothing is saved. The error text is the result:
"Test finished, nothing saved: N checks, 0 failed".  python3 tests/make_rls_live.py"""
from pathlib import Path
here = Path(__file__).parent
src = (here / "rls-test.sql").read_text()
body = src.split("-- ---------- report ----------")[0]
body = "\n".join(l for l in body.splitlines() if not l.startswith("\\"))
out = f"""-- Live who-sees-what test for the Supabase SQL Editor. Generated from rls-test.sql by make_rls_live.py.
-- Run it right after schema.sql, before adding any real members. It always ends in a red error message:
-- that message is the result, and the error also undoes every test row (nothing is saved).
begin;
{body}
do $$
declare bad int; total int; which text;
begin
  select count(*) filter (where not ok), count(*), string_agg(label || ' (' || coalesce(detail, '') || ')', '; ' order by n) filter (where not ok)
    into bad, total, which from t.results;
  raise exception 'Test finished, nothing saved: % checks, % failed%', total, bad, coalesce(': ' || which, '');
end $$;
"""
(here / "rls-live.sql").write_text(out)
print("wrote tests/rls-live.sql")
