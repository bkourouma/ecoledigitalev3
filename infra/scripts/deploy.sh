#!/usr/bin/env bash
# Server-side deploy script — invoked by the GitHub Actions self-hosted runner
# (workflow: .github/workflows/deploy.yml). Runs as the `deployer` user.
#
# Idempotent: build images, restart compose stack, wait for health, prune.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/infra/compose/docker-compose.yml"
ENV_FILE="${ENV_FILE:-/home/deployer/ecoledigitale.env}"
PROJECT="${COMPOSE_PROJECT:-ecoledigitale}"
API_CONTAINER_NAME="${API_CONTAINER_NAME:-ecoledigitale-api}"
DEPLOY_HEALTH_URL="${DEPLOY_HEALTH_URL:-https://ecoledigitale.allianceconsultants.net/health}"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "env file not found: $ENV_FILE" >&2
    exit 1
fi

# Export so the compose file's `env_file: ${ENV_FILE:-./.env}` resolves
# correctly. --env-file alone only loads the file's contents; the literal
# variable name still has to be in the shell env.
export ENV_FILE

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -p "$PROJECT" "$@"; }

echo "== build images =="
dc build --pull ecoledigitale-api ecoledigitale-web ecoledigitale-formation-pro

echo "== start postgres =="
dc up -d postgres

# `0055_unified_multitenancy.sql` a tenantisé toutes les BASE TABLE de `public`,
# y compris `_prisma_migrations` (journal interne du moteur Prisma). Prisma
# ignore cette colonne : son INSERT viole le NOT NULL et la policy RLS forcée,
# et `migrate deploy` échoue. On rétablit la table dans son schéma d'origine.
# Idempotent — no-op sur une base déjà saine. Voir migration 0090.
echo "== repair _prisma_migrations (drop tenant_id/RLS added by 0055) =="
set -a; source "$ENV_FILE"; set +a
PG_USER="${POSTGRES_USER:?POSTGRES_USER not set in $ENV_FILE}"
PG_DB="${POSTGRES_DB:-dbecoledigitale}"

for _ in $(seq 1 30); do
    dc exec -T postgres pg_isready -U "$PG_USER" -d postgres >/dev/null 2>&1 && break
    sleep 2
done

dc exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE IF EXISTS "_prisma_migrations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON "_prisma_migrations";
ALTER TABLE IF EXISTS "_prisma_migrations"
    DROP CONSTRAINT IF EXISTS fk__prisma_migrations_tenant_id;
DROP INDEX IF EXISTS idx__prisma_migrations_tenant_id;
ALTER TABLE IF EXISTS "_prisma_migrations" DROP COLUMN IF EXISTS tenant_id;
SQL

echo "== run database migrations =="
dc run --rm --no-deps ecoledigitale-api ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma

echo "== bring up stack =="
dc up -d --remove-orphans

echo "== wait for api healthcheck =="
deadline=$(( $(date +%s) + 180 ))
while :; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$API_CONTAINER_NAME" 2>/dev/null || echo "starting")
    if [[ "$status" == "healthy" ]]; then
        echo "api: healthy"
        break
    fi
    if (( $(date +%s) > deadline )); then
        echo "api never became healthy (status=$status)" >&2
        dc logs --tail=200 ecoledigitale-api >&2 || true
        exit 1
    fi
    sleep 5
done

echo "== prune dangling images =="
docker image prune -f >/dev/null

echo "== smoke test via nginx =="
if curl -fsS --max-time 10 "$DEPLOY_HEALTH_URL" >/dev/null; then
    echo "$DEPLOY_HEALTH_URL: ok"
else
    echo "WARNING: public health endpoint not responding (DNS/cert may not be live yet)" >&2
fi

echo "deploy complete."
