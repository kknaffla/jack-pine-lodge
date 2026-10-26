#!/bin/bash
# Fresh throwaway database -> stub -> schema (twice, to prove it re-runs) -> who-sees-what test.
# Usage: PSQL="psql -h 127.0.0.1 -p 5432 -U postgres" tests/rls.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=${PSQL:-psql}
$PSQL -d postgres -qc "drop database if exists jpl_rls_test" -c "create database jpl_rls_test" >/dev/null
$PSQL -d postgres -qc "drop role if exists anon" -c "drop role if exists authenticated" >/dev/null 2>&1 || true
$PSQL -d jpl_rls_test -v ON_ERROR_STOP=1 -q -f tests/db-stub.sql -f supabase/schema.sql 2>&1 | grep -v NOTICE || true
$PSQL -d jpl_rls_test -v ON_ERROR_STOP=1 -q -f supabase/schema.sql 2>&1 | grep -v NOTICE || true
$PSQL -d jpl_rls_test -v ON_ERROR_STOP=1 -f tests/rls-test.sql
