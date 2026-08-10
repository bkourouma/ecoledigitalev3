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

# Lire une variable du fichier d'environnement SANS l'exécuter. `source` ferait
# interpréter les valeurs par bash : une valeur non quotée contenant un espace
# (p. ex. SUPER_ADMIN_NAME) est alors prise pour une commande et le script meurt
# sur « command not found ». Docker Compose, lui, parse ce format sans shell.
read_env_var() {
    sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" \
        | head -1 \
        | tr -d '\r' \
        | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

PG_USER="$(read_env_var POSTGRES_USER)"
PG_DB="$(read_env_var POSTGRES_DB)"
: "${PG_USER:?POSTGRES_USER not set in $ENV_FILE}"
PG_DB="${PG_DB:-dbecoledigitale}"

for _ in $(seq 1 30); do
    dc exec -T postgres pg_isready -U "$PG_USER" -d postgres >/dev/null 2>&1 && break
    sleep 2
done

# Le bloc entier est gardé par to_regclass : sur une base neuve la table
# n'existe pas encore (Prisma la crée au premier `migrate deploy`), et le
# `IF EXISTS` de DROP POLICY ne porte que sur la policy — pas sur la table.
dc exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
    IF to_regclass('public._prisma_migrations') IS NULL THEN
        RETURN;
    END IF;

    EXECUTE 'ALTER TABLE "_prisma_migrations" NO FORCE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "_prisma_migrations" DISABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation_policy ON "_prisma_migrations"';
    EXECUTE 'ALTER TABLE "_prisma_migrations" DROP CONSTRAINT IF EXISTS fk__prisma_migrations_tenant_id';
    EXECUTE 'DROP INDEX IF EXISTS idx__prisma_migrations_tenant_id';
    EXECUTE 'ALTER TABLE "_prisma_migrations" DROP COLUMN IF EXISTS tenant_id';
END $$;

-- `20260515112000_seed_reference_roles` crée l'index unique
-- (tenant_id, user_id, role_id) sur user_roles. Comme cette migration est
-- neutralisée plus bas sur les bases à rôles globaux, on pose l'index ici :
-- c'est le seul apport réel qu'elle a pour ces bases.
DO $$
BEGIN
    IF to_regclass('public.user_roles') IS NULL THEN
        RETURN;
    END IF;
    BEGIN
        CREATE UNIQUE INDEX IF NOT EXISTS user_roles_tenant_id_user_id_role_id_key
            ON user_roles (tenant_id, user_id, role_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'user_roles: doublons (tenant_id,user_id,role_id) — index non créé';
    END;
END $$;
SQL

# `20260515112000_seed_reference_roles` prépare des bases NEUVES : elle insère
# le tenant de référence et 6 rôles via `ON CONFLICT (tenant_id, key)`. Sur une
# base héritée, les rôles sont GLOBAUX (tenant_id NULL, unicité sur `key` seul)
# et ce couple n'a aucun index unique → Postgres renvoie 42P10, et l'échec
# bloque ensuite toute migration (P3018).
#
# Rien n'y serait gagné : `user_roles.tenant_id` est déjà posé par 0055, le
# tenant et les 6 rôles existent, et l'index user_roles vient d'être créé
# ci-dessus. On marque donc la migration comme appliquée sans l'exécuter.
NEEDS_SKIP=$(dc exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "
SELECT CASE WHEN EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL)
             AND NOT EXISTS (
                   SELECT 1 FROM \"_prisma_migrations\"
                    WHERE migration_name = '20260515112000_seed_reference_roles'
                      AND finished_at IS NOT NULL)
            THEN 'yes' ELSE 'no' END;" | tr -d '[:space:]')

if [[ "$NEEDS_SKIP" == "yes" ]]; then
    echo "== skip seed_reference_roles (base à rôles globaux) =="
    dc run --rm --no-deps ecoledigitale-api \
        ./node_modules/.bin/prisma migrate resolve \
        --applied 20260515112000_seed_reference_roles \
        --schema prisma/schema.prisma
fi

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
