#!/usr/bin/env bash
# deploy-locally.sh: Start EAJ (API + Vite UI) and open the primary URL.
#
# Environment variables:
#   PRIMARY_URL      URL to open (default: http://localhost:5173)
#   HEALTH_TIMEOUT   Seconds to wait for primary URL (default: 60)
#   PORT             API port (default: 3000)
#   DATA_DIR         SQLite data directory (default: ./data)
#
# Usage: ./deploy-locally.sh
# Stop: Ctrl+C (trap stops background processes started by this script)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

PORT="${PORT:-3000}"
PRIMARY_URL="${PRIMARY_URL:-http://localhost:5173}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"
export DATA_DIR="${DATA_DIR:-$REPO_ROOT/data}"
export PORT

PIDS=()

info()  { printf '\033[0;34m[INFO]\033[0m %s\n' "$*"; }
warn()  { printf '\033[0;33m[WARN]\033[0m %s\n' "$*"; }
error() { printf '\033[0;31m[ERROR]\033[0m %s\n' "$*" >&2; }

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      info "Stopping background process $pid"
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT INT TERM

open_url() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url"
  elif command -v start >/dev/null 2>&1; then
    start "$url"
  else
    warn "Could not detect browser opener. Open manually: $url"
    return 1
  fi
}

wait_for_url() {
  local url="$1"
  local timeout="${2:-30}"
  local elapsed=0

  case "$url" in
    file://*) return 0 ;;
    http://*|https://*) ;;
    *)
      warn "Skipping health check for unsupported URL scheme: $url"
      return 0
      ;;
  esac

  info "Waiting for $url (timeout: ${timeout}s)"
  while ! curl -sf "$url" >/dev/null 2>&1; do
    if (( elapsed >= timeout )); then
      error "Timed out waiting for $url"
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  info "Ready: $url"
}

start_background() {
  local cmd="$1"
  info "Starting: $cmd"
  bash -c "$cmd" &
  PIDS+=($!)
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

listeners_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  fi
}

# A pre-day-lifecycle API returns 404 for /api/days/active; 401 means the route exists.
stale_api_listener() {
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/days/active" 2>/dev/null || echo "000")"
  [[ "$code" == "404" ]]
}

stop_port_listeners() {
  local port="$1"
  local pid
  for pid in $(listeners_on_port "$port"); do
    info "Stopping stale listener on :$port (pid $pid)"
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
}

start_services() {
  cd "$REPO_ROOT"

  if ! command -v bun >/dev/null 2>&1; then
    error "Bun is required. Install from https://bun.sh"
    exit 1
  fi

  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    info "Installing dependencies"
    bun install
  fi

  mkdir -p "$DATA_DIR"

  if port_in_use "$PORT"; then
    if stale_api_listener; then
      warn "Port $PORT is serving an outdated API (missing /api/days/active); restarting"
      stop_port_listeners "$PORT"
      start_background "cd \"$REPO_ROOT\" && bun run --filter @eaj/server dev"
    else
      warn "Port $PORT already in use; will health-check existing listener"
    fi
  else
    start_background "cd \"$REPO_ROOT\" && bun run --filter @eaj/server dev"
  fi

  if port_in_use 5173; then
    warn "Port 5173 already in use; will health-check existing listener"
  else
    start_background "cd \"$REPO_ROOT\" && bun run --filter @eaj/web dev"
  fi
}

main() {
  info "Deploying EAJ locally from $REPO_ROOT"
  start_services
  wait_for_url "http://localhost:${PORT}/api/health" "$HEALTH_TIMEOUT"
  wait_for_url "$PRIMARY_URL" "$HEALTH_TIMEOUT"
  open_url "$PRIMARY_URL"
  info "Done. Primary URL: $PRIMARY_URL (API on :$PORT)"
  if ((${#PIDS[@]})); then
    info "Press Ctrl+C to stop background processes started by this script."
    wait
  else
    info "No new processes started (ports were already in use). Exiting after open."
  fi
}

main "$@"
