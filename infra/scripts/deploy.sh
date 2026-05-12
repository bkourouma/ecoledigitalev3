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
