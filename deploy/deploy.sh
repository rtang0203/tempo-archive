#!/usr/bin/env bash
# Build Tempo Atlas for linux/amd64 on this machine and deploy it to the market-data droplet.
# The droplet keeps /opt/tempo-atlas/.env (secrets) and the tempo_atlas database; neither is touched here.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${HOST:-market-data}

docker buildx build --platform linux/amd64 -t tempo-atlas-app:latest --load .
docker buildx build --platform linux/amd64 -t tempo-atlas-analyzer:latest --load analyzer

docker save tempo-atlas-app:latest tempo-atlas-analyzer:latest | gzip -1 | ssh "$HOST" 'gunzip | docker load'
scp -q deploy/docker-compose.droplet.yml "$HOST":/opt/tempo-atlas/docker-compose.yml

ssh "$HOST" 'set -e
cd /opt/tempo-atlas
docker compose run --rm --no-deps web node --import tsx src/db/migrate.ts
docker compose up -d --remove-orphans
docker image prune -f >/dev/null
curl -fsS -o /dev/null -w "local web %{http_code}\n" http://127.0.0.1:3100/'
