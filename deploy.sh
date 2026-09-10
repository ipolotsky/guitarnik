#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

git fetch --prune origin
git reset --hard origin/main

docker compose up -d --build
docker image prune -f >/dev/null

sleep 5
docker compose ps --format '{{.Name}} {{.Status}}'
