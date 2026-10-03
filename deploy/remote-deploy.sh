#!/bin/sh
# Runs ON the production server (called by .github/workflows/deploy.yml).
#
#   remote-deploy.sh <image> <version>
#
# 1. backs up the database (migrations only move forward),
# 2. starts the new API image (migrations run on startup),
# 3. waits until /version reports the new version and /readyz is healthy,
# 4. otherwise redeploys the previous image and fails.
#
# Expects /opt/hooshban/.env with the production secrets and API_DOMAIN.
set -eu

IMAGE="$1"
VERSION="$2"
cd /opt/hooshban

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
PREVIOUS="$(cat .deployed-image 2>/dev/null || true)"
DOMAIN="$(grep -E '^API_DOMAIN=' .env | cut -d= -f2-)"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

log "backing up database"
mkdir -p backups
if $COMPOSE ps --status running postgres >/dev/null 2>&1; then
  $COMPOSE exec -T postgres pg_dump -U hooshban hooshban | gzip > "backups/pre-$VERSION-$(date -u +%Y%m%dT%H%M%S).sql.gz"
fi
# Keep the 20 most recent backups.
ls -1t backups/*.sql.gz 2>/dev/null | tail -n +21 | xargs -r rm --

start() {
  API_IMAGE="$1" $COMPOSE up -d --no-build --remove-orphans
}

healthy() {
  want="$1"
  i=0
  while [ $i -lt 40 ]; do
    got="$(curl -fsS --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
    if [ "$got" = "$want" ] && curl -fsS --max-time 5 --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null "https://$DOMAIN/readyz"; then
      return 0
    fi
    i=$((i + 1))
    sleep 3
  done
  return 1
}

log "starting $IMAGE"
start "$IMAGE"

if healthy "$VERSION"; then
  echo "$IMAGE" > .deployed-image
  log "version $VERSION is live"
  docker image prune -f >/dev/null
  exit 0
fi

log "health check FAILED for $VERSION"
$COMPOSE logs --tail 80 api || true
if [ -n "$PREVIOUS" ]; then
  log "rolling back to $PREVIOUS"
  start "$PREVIOUS"
fi
exit 1
