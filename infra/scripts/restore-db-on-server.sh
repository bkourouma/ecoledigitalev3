#!/usr/bin/env bash
# Restore a pg_dump (custom format) into the dockerized postgres on the VPS.
#
# Usage:
#   ./infra/scripts/restore-db-on-server.sh /tmp/ecoledigitale.dump
#
# Requires:
#   - docker compose stack already created (postgres container running)
#   - /home/deployer/ecoledigitale.env populated with POSTGRES_USER / POSTGRES_DB
#
# This DROPs and RECREATEs the target DB. Intended for the initial seed
# from your local demo data. Do NOT run blindly on a populated production DB.

set -euo pipefail

DUMP_FILE="${1:-}"
if [[ -z "$DUMP_FILE" || ! -f "$DUMP_FILE" ]]; then
    echo "usage: $0 /path/to/dump.dump" >&2
    exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/infra/compose/docker-compose.yml"
ENV_FILE="${ENV_FILE:-/home/deployer/ecoledigitale.env}"
PROJECT="${COMPOSE_PROJECT:-ecoledigitale}"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "env file not found: $ENV_FILE" >&2
    exit 1
fi

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER not set in $ENV_FILE}"
POSTGRES_DB="${POSTGRES_DB:-dbecoledigitale}"

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT" "$@"; }

echo ">> ensuring postgres container is up"
dc up -d postgres

echo ">> waiting for postgres to be ready"
for i in {1..30}; do
    if dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; then
        break
    fi
    sleep 2
done

read -r -p "DROP and recreate database '$POSTGRES_DB' on the server? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "aborted."
    exit 0
fi

echo ">> stopping app containers (api, web) so they release pg connections"
dc stop ecoledigitale-api ecoledigitale-web 2>/dev/null || true

echo ">> dropping and recreating $POSTGRES_DB"
dc exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$POSTGRES_DB";
CREATE DATABASE "$POSTGRES_DB" OWNER "$POSTGRES_USER";
SQL

echo ">> restoring dump ($DUMP_FILE)"
docker cp "$DUMP_FILE" ecoledigitale-postgres:/tmp/restore.dump
dc exec -T postgres pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --no-owner --no-privileges \
    --exit-on-error \
    /tmp/restore.dump
dc exec -T postgres rm -f /tmp/restore.dump

echo ">> restore complete; bringing app containers back up"
dc up -d ecoledigitale-api ecoledigitale-web

echo "done."
