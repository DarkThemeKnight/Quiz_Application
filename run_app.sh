#!/usr/bin/env bash
# Start Recall Studio locally.
#
#   ./run_app.sh            development mode (hot reload)  → http://127.0.0.1:5173
#   ./run_app.sh prod       production build, one process  → http://127.0.0.1:4000
#   ./run_app.sh --help
#
# Steps: selects Node from .nvmrc, enables pnpm, installs dependencies if needed, checks .env,
# applies pending migrations, then starts the app. Reads settings from .env and never prints secrets.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

MODE="${1:-dev}"
case "$MODE" in
  dev | prod) ;;
  -h | --help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "Unknown mode '$MODE'. Use: ./run_app.sh [dev|prod]" >&2
    exit 1
    ;;
esac

info() { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
fail() {
  printf '\033[1;31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

# --- Node -----------------------------------------------------------------------------------------
REQUIRED_MAJOR="$(tr -dc '0-9' <.nvmrc 2>/dev/null || echo 24)"
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(node_major)" -lt "$REQUIRED_MAJOR" ]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use --silent "$REQUIRED_MAJOR" >/dev/null 2>&1 || nvm use --silent >/dev/null 2>&1 || true
  fi
fi
[ "$(node_major)" -ge "$REQUIRED_MAJOR" ] ||
  fail "Node $REQUIRED_MAJOR+ is required (found $(node -v 2>/dev/null || echo none)). Install it with: nvm install $REQUIRED_MAJOR"
info "Node $(node -v)"

# --- pnpm -----------------------------------------------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  info "Enabling pnpm via corepack"
  corepack enable >/dev/null 2>&1 || fail "pnpm not found and corepack could not enable it. Run: npm i -g corepack && corepack enable"
fi

# --- .env -----------------------------------------------------------------------------------------
if [ ! -f .env ]; then
  fail ".env not found. Copy the template and fill it in:  cp .env.example .env  (see README → Setup)"
fi

# --- Dependencies ---------------------------------------------------------------------------------
if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
  info "Installing dependencies"
  pnpm install --frozen-lockfile
fi

# --- Database migrations --------------------------------------------------------------------------
info "Applying database migrations (if any)"
pnpm --silent db:migrate || fail "Migration failed. Is PostgreSQL running and DATABASE_URL in .env correct?"

# Port from .env (or default) for the banner and production origin.
env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- | tr -d '"'"'" || true; }
APP_PORT="${APP_PORT:-$(env_value APP_PORT)}"
APP_PORT="${APP_PORT:-4000}"
WEB_PORT="${WEB_PORT:-$(env_value WEB_PORT)}"
WEB_PORT="${WEB_PORT:-5173}"

echo
echo "  First run? Create your login in another terminal:  pnpm owner:create"
echo

# --- Start ----------------------------------------------------------------------------------------
if [ "$MODE" = "dev" ]; then
  info "Starting development servers → http://127.0.0.1:${WEB_PORT}  (Ctrl+C to stop)"
  export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:${WEB_PORT}}"
  exec pnpm dev
else
  info "Building production bundle"
  pnpm build
  info "Starting production server → http://127.0.0.1:${APP_PORT}  (Ctrl+C to stop)"
  # Values already in the environment take precedence over .env, so the browser origin matches.
  export NODE_ENV=production
  export APP_ORIGIN="http://127.0.0.1:${APP_PORT}"
  exec pnpm start
fi
