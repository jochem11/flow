#!/usr/bin/env bash
# Flow in development with one command: the server and its database in Docker (in
# the background), then Flow Dev. Closing the app (or Ctrl+C) stops the server again.
#   npm run start:dev        the desktop app (Flow Dev)
#   npm run start:dev:web    the web version on http://localhost:1420 instead
set -euo pipefail
cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running: start Docker Desktop first." >&2
  exit 1
fi

docker compose up -d --build
trap 'echo; echo "Stopping the server..."; docker compose stop' EXIT

printf "Waiting for the server"
for _ in $(seq 1 60); do
  if curl -so /dev/null http://localhost:8080/; then break; fi
  printf "."
  sleep 1
done
echo
echo "Server: http://localhost:8080   (its log: docker compose logs -f flow)"

if [ "${1:-}" = "web" ]; then
  npm run dev
else
  npm run app:dev
fi
