#!/usr/bin/env bash
# The whole app on this machine, against the launchpad that is really deployed on Sepolia.
#
#   the real chain  ->  the indexer  ->  Postgres  ->  the API  ->  the web app   (+ Redis, and the migration bot)
#
# Unlike scripts/e2e.sh there is no fork and nothing is deployed or faked: every transaction is a real Sepolia transaction and
# costs real (test) ETH. What it reads:
#   TokenLaunchpad-be/packages/deployments/sepolia.json   the deployed addresses (copy the contracts repo's deployments/sepolia.json here)
#   ../EVM-Pumpfun-Smart-Contract/.env  SEPOLIA_RPC_URL: your own RPC, used by the indexer, the API and the bot (never the browser)
#   TokenLaunchpad-be/.env                       PINATA_JWT: token images and metadata are pinned to IPFS for real
#   TokenLaunchpad-fe/.env.local                 NEXT_PUBLIC_PRIVY_APP_ID and NEXT_PUBLIC_RPC_URL, as for `pnpm dev`
# What it creates, and keeps between runs (so comments, stars and profiles survive): the database vezta_demo, and a BOT_PRIVATE_KEY line
# in TokenLaunchpad-be/.env (a wallet of the bot's own; send it a little Sepolia ETH so it can migrate curves that fill), if it is not
# there yet. Redis is its own, on :6392, never yours.
#
#   (from TokenLaunchpad-be)
#   ./scripts/demo-sepolia.sh
#   ADMIN_ADDRESSES=0xYourTradingWallet ./scripts/demo-sepolia.sh     (see "Admin" below)
#   WEB_PORT=3000 API_PORT=3201 ./scripts/demo-sepolia.sh
#
# Admin: an admin is identified by the TRADING wallet address (the address the header's wallet menu shows), not the main wallet.
# Connect once, copy that address from the menu, and start again with ADMIN_ADDRESSES set to it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # TokenLaunchpad-be: the backend, and where these scripts live
WEB="$(cd "$ROOT/../TokenLaunchpad-fe" && pwd)"   # the frontend
CONTRACTS="${CONTRACTS_DIR:-$ROOT/../../EVM-Pumpfun-Smart-Contract}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-3201}"
PONDER_PORT="${PONDER_PORT:-42072}"
REDIS_PORT="${REDIS_PORT:-6392}" # never 6379: that is a developer's own Redis
DB="${DEMO_DB:-vezta_demo}"
DB_USER="$(whoami)"
DB_URL="postgresql://$DB_USER@localhost:5432/$DB"
LOGS="${DEMO_LOG_DIR:-$(mktemp -d)}"
PIDS=()

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Each service is started as `( cd ... && pnpm start ) &`, so $! is the SUBSHELL and the real servers are its descendants:
# children go first, or they are re-parented and can no longer be found.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  local code=$?
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill_tree "$pid"; done
  pkill -f "redis-server .*--port $REDIS_PORT" 2>/dev/null || true
  echo "logs: $LOGS"
  exit $code
}
trap cleanup EXIT INT TERM

# --- pre-flight ----------------------------------------------------------------------------------------------------------
for tool in cast pnpm node redis-server redis-cli; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
PGBIN=""
for dir in "$(dirname "$(command -v psql 2>/dev/null || echo /nonexistent/psql)")" /usr/local/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@16/bin; do
  [ -x "$dir/createdb" ] && PGBIN="$dir" && break
done
[ -n "$PGBIN" ] || die "Postgres client tools (createdb, psql) not found"
"$PGBIN/psql" -d postgres -Atc "select 1" >/dev/null 2>&1 || die "Postgres is not running on :5432"
[ -s "$ROOT/packages/deployments/sepolia.json" ] || die "TokenLaunchpad-be/packages/deployments/sepolia.json is missing: copy the contracts repo's deployments/sepolia.json there"
for port in "$WEB_PORT" "$API_PORT" "$PONDER_PORT" "$REDIS_PORT"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then die "port $port is already in use; choose another with WEB_PORT / API_PORT / PONDER_PORT / REDIS_PORT"; fi
done

# The RPC is read from the file, never echoed. Only the indexer, API and bot get it: the browser has its own (TokenLaunchpad-fe/.env.local).
RPC=""
[ -f "$CONTRACTS/.env" ] && RPC="$(grep -E '^SEPOLIA_RPC_URL=' "$CONTRACTS/.env" | head -1 | cut -d= -f2-)"
RPC="${SEPOLIA_RPC_URL:-$RPC}"
case "$RPC" in http*://*) ;; *) die "no SEPOLIA_RPC_URL: set it in $CONTRACTS/.env, or in the environment";; esac
case "$RPC" in *"<"*) die "SEPOLIA_RPC_URL in $CONTRACTS/.env is still the placeholder";; esac
[ "$(cast chain-id --rpc-url "$RPC" 2>/dev/null)" = "11155111" ] || die "that RPC did not answer as Sepolia (chain id 11155111)"

LAUNCHPAD="$(node -pe "require('$ROOT/packages/deployments/sepolia.json').launchpad")"
[ "$(cast code "$LAUNCHPAD" --rpc-url "$RPC" | wc -c)" -gt 10 ] || die "there is no contract at $LAUNCHPAD on Sepolia"
echo "launchpad: $LAUNCHPAD (Sepolia)"

# --- database --------------------------------------------------------------------------------------------------------------
log "Database $DB"
"$PGBIN/psql" -d postgres -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1 || "$PGBIN/createdb" "$DB"
(cd "$ROOT/packages/app-db" && DATABASE_URL="$DB_URL" pnpm exec prisma migrate deploy > "$LOGS/migrate.log" 2>&1) || { tail "$LOGS/migrate.log"; die "prisma migrate failed"; }
# Ponder keeps its tables in a schema of its own for each run: the ones of earlier runs are only clutter.
for schema in $("$PGBIN/psql" -d "$DB" -Atc "select nspname from pg_namespace where nspname like 'demo\_%'"); do
  "$PGBIN/psql" -d "$DB" -qc "drop schema \"$schema\" cascade" >/dev/null
done

# --- indexer ---------------------------------------------------------------------------------------------------------------
log "Starting the indexer (from the deployment block)"
(cd "$ROOT/apps/indexer" && DEPLOYMENT=sepolia DATABASE_URL="$DB_URL" PONDER_RPC_URL_11155111="$RPC" PONDER_SCHEMA="demo_$$" \
  pnpm start:views --port "$PONDER_PORT" > "$LOGS/indexer.log" 2>&1) &
PIDS+=($!)
wait_for() { # wait_for "<what>" <seconds> <command...>
  local what="$1" seconds="$2"; shift 2
  for _ in $(seq 1 "$seconds"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  die "timed out after ${seconds}s waiting for $what (logs in $LOGS)"
}
wait_for "the indexer" 180 curl -sf "http://localhost:$PONDER_PORT/ready"

# --- redis and the bot -----------------------------------------------------------------------------------------------------
log "Starting Redis on :$REDIS_PORT and the migration bot"
redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no --loglevel warning > "$LOGS/redis.log" 2>&1 &
PIDS+=($!)
wait_for "Redis" 30 redis-cli -p "$REDIS_PORT" ping
BOT_KEY="$(grep -E '^BOT_PRIVATE_KEY=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [ -z "$BOT_KEY" ]; then
  BOT_KEY="$(cast wallet new | awk '/Private key/ {print $3}')"
  # A wallet of the bot's own (git-ignored). Replaces a blank BOT_PRIVATE_KEY= line if there is one, else adds it.
  { [ -f "$ROOT/.env" ] && grep -vE '^BOT_PRIVATE_KEY=' "$ROOT/.env" || true; printf 'BOT_PRIVATE_KEY=%s\n' "$BOT_KEY"; } > "$ROOT/.env.tmp"
  (umask 077; mv "$ROOT/.env.tmp" "$ROOT/.env")
fi
BOT_ADDR="$(cast wallet address --private-key "$BOT_KEY")"
echo "bot wallet: $BOT_ADDR  balance: $(cast balance "$BOT_ADDR" --rpc-url "$RPC" -e) ETH (it needs a little to migrate a curve that fills)"
# A free RPC plan answers eth_getLogs for a handful of blocks at most (Alchemy: 10) and refuses a wider request: ten is safe on any plan.
# With an RPC that allows more, LOG_RANGE_BLOCKS=2000 makes the bot's catch-up far quicker.
(cd "$ROOT/apps/bot" && DEPLOYMENT=sepolia RPC_URL="$RPC" BOT_PRIVATE_KEY="$BOT_KEY" REDIS_URL="redis://127.0.0.1:$REDIS_PORT" LOG_RANGE_BLOCKS="${LOG_RANGE_BLOCKS:-10}" \
  pnpm start > "$LOGS/bot.log" 2>&1) &
PIDS+=($!)
wait_for "the bot" 60 grep -q "watching" "$LOGS/bot.log"

# --- api -------------------------------------------------------------------------------------------------------------------
log "Starting the API on :$API_PORT"
PINATA_JWT="$(grep -E '^PINATA_JWT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
[ -n "$PINATA_JWT" ] || die "no PINATA_JWT in TokenLaunchpad-be/.env: without it a token's image and details cannot be pinned"
(cd "$ROOT/apps/api" && DATABASE_URL="$DB_URL" DEPLOYMENT=sepolia PORT="$API_PORT" CORS_ORIGINS="http://localhost:$WEB_PORT" \
  WEB_ORIGIN="http://localhost:$WEB_PORT" PINATA_JWT="$PINATA_JWT" RPC_URL="$RPC" REDIS_URL="redis://127.0.0.1:$REDIS_PORT" \
  ADMIN_ADDRESSES="${ADMIN_ADDRESSES:-}" INDEXER_URL="http://localhost:$PONDER_PORT" pnpm start > "$LOGS/api.log" 2>&1) &
PIDS+=($!)
wait_for "the API" 60 curl -sf "http://localhost:$API_PORT/ready"

# --- web -------------------------------------------------------------------------------------------------------------------
log "Building and starting the web app on :$WEB_PORT"
# Built into a folder of its own: the browser tests build the app too (into .next), and a build overwrites the files a running server serves.
export NEXT_DIST_DIR=.next-demo
(cd "$WEB" && DEPLOYMENT=sepolia NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" pnpm exec next build > "$LOGS/web-build.log" 2>&1) \
  || { tail -20 "$LOGS/web-build.log"; die "the web build failed"; }
(cd "$WEB" && pnpm exec next start -p "$WEB_PORT" > "$LOGS/web.log" 2>&1) &
PIDS+=($!)
wait_for "the web app" 60 curl -sf "http://localhost:$WEB_PORT/sepolia"

printf '\n\033[1m==> Ready\033[0m\n  app:  http://localhost:%s/sepolia\n  api:  http://localhost:%s\n  logs: %s\n  Ctrl-C stops everything it started.\n' "$WEB_PORT" "$API_PORT" "$LOGS"
wait
