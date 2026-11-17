#!/usr/bin/env bash
# Applies every supabase/*.sql file to a throwaway PostgreSQL container (with a
# Supabase stub), checks they can be re-run, and runs the permission tests.
# Usage: npm run test:sql   (needs Docker)
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${PG_IMAGE:-postgres:18}"
NAME="datachat-sqltest-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null && break
  sleep 1
done
sleep 1

psql_sql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X -c "$1"; }

apply() {
  docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X < "$1" >/tmp/datachat-sql.log 2>&1 \
    || { cat /tmp/datachat-sql.log; echo "FAILED applying $1"; exit 1; }
  echo "ok    applied $1"
}

MIGRATIONS=(schema realtime_chat production_upgrade auth_codes_upgrade security_hardening)

apply tests/sql/supabase_stub.sql
for m in "${MIGRATIONS[@]:0:4}"; do apply "supabase/$m.sql"; done

# Data as it exists before the hardening migration.
psql_sql "insert into auth.users (id, email, raw_user_meta_data) values
  ('7f3c1a52-9d0e-4b8a-a1f2-0c5d6e7f8a91', 'alice@example.test', '{\"name\":\"Alice\",\"username\":\"alice\",\"phone\":\"+111\"}'),
  ('2b9e4c7d-1a3f-4e5b-8c6d-7e8f9a0b1c2d', 'bob@example.test',   '{\"name\":\"Bob\",\"username\":\"bob\",\"phone\":\"+222\"}'),
  ('c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f', 'carol@example.test', '{\"name\":\"Carol\",\"username\":\"carol\",\"phone\":\"+333\"}');
  insert into public.pro_access_codes (code, status, used_by, used_at)
  values ('LEGACY-USED-CODE-1', 'used', 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f', now());" >/dev/null
echo "ok    seeded pre-hardening data"

apply supabase/security_hardening.sql

# Every file must be safe to run again, in order.
for m in "${MIGRATIONS[@]}"; do apply "supabase/$m.sql"; done
echo "ok    all migrations re-ran cleanly"

docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q -X < tests/sql/assertions.sql 2>&1 \
  | sed -n 's/^psql:[^ ]* NOTICE:  //p; s/^NOTICE:  //p; /PASSED/p; /ERROR/p; /FAIL/p'
status=${PIPESTATUS[0]}
exit "$status"
