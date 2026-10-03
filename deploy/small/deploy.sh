#!/usr/bin/env bash
# Deploys an API image on a small server (deploy/small stack). Run by the
# Azure Pipelines agent on the server, or by hand:
#
#   deploy/small/deploy.sh <image:tag> <version>
#
# 1. backs up the database (migrations only move forward),
# 2. recreates the API container with the new image (migrations run on start),
# 3. waits for /version == <version> and /readyz,
# 4. otherwise puts the previous image back and fails.
#
# Secrets live outside the repository, in /opt/hooshban/.env.
set -euo pipefail

IMAGE="$1"
VERSION="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE=/opt/hooshban
ENV_FILE="$STATE/.env"
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo -n docker"

compose() { $DOCKER compose -p hooshban -f "$HERE/docker-compose.yml" --env-file "$ENV_FILE" "$@"; }
log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

PORT="$(grep -E '^API_PORT=' "$ENV_FILE" | cut -d= -f2-)"; PORT="${PORT:-8080}"
PREVIOUS="$(cat "$STATE/.deployed-image" 2>/dev/null || true)"

log "backing up database"
mkdir -p "$STATE/backups"
if compose ps --status running postgres >/dev/null 2>&1; then
  compose exec -T postgres pg_dump -U hooshban hooshban | gzip > "$STATE/backups/pre-$VERSION-$(date -u +%Y%m%dT%H%M%S).sql.gz"
fi
ls -1t "$STATE"/backups/*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm --   # keep 10

start() { API_IMAGE="$1" compose up -d --no-build; }

healthy() {
  for _ in $(seq 1 40); do
    got="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    if [ "$got" = "$1" ] && curl -fsS --max-time 5 -o /dev/null "http://127.0.0.1:$PORT/readyz"; then
      return 0
    fi
    sleep 3
  done
  return 1
}

log "starting $IMAGE"
start "$IMAGE"
if healthy "$VERSION"; then
  echo "$IMAGE" > "$STATE/.deployed-image"
  log "version $VERSION is live"
  # Small disks: drop superseded images, keep the running and previous ones.
  $DOCKER image ls --format '{{.Repository}}:{{.Tag}}' hooshban-api \
    | grep -vxF -e "$IMAGE" -e "${PREVIOUS:-none}" | xargs -r $DOCKER image rm >/dev/null 2>&1 || true
  exit 0
fi

log "health check FAILED for $VERSION"
compose logs --tail 60 api || true
if [ -n "$PREVIOUS" ]; then
  log "rolling back to $PREVIOUS"
  start "$PREVIOUS"
fi
exit 1
