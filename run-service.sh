#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# systemd does not load ~/.bashrc — expose Bun for hosting-site@
export PATH="${HOME}/.bun/bin:${PATH}"

# Load .env if it exists (set +e so invalid lines don't kill startup)
if [ -f .env ]; then
  set +e
  set -a
  source .env 2>/dev/null
  set +a
  set -e
fi

PORT="${PORT:-3000}"
export PORT

# Outside Hosting tree: deploy-repo rsync --delete does not exclude data/
export DATA_DIR="${DATA_DIR:-$HOME/.local/share/eaj}"
mkdir -p "$DATA_DIR"

# TLS terminates at Cloudflare; cookies need Secure in production
export COOKIE_SECURE="${COOKIE_SECURE:-1}"

if ! command -v bun >/dev/null 2>&1; then
  echo "▸ bun is required — install from https://bun.sh" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "▸ Installing dependencies..."
  bun install
fi

# Always rebuild: rsync excludes dist; code changes must refresh apps/web/dist
echo "▸ Building web app..."
bun run build

echo "▸ Starting energyaccounting on port $PORT..."
exec bun run start
