#!/usr/bin/env bash
# The whole read-only journey, end to end, in one command.
#
# It builds a private copy of the stack and drives a real Chrome against it:
#   a local fork of Sepolia with the launchpad deployed  ->  the real Ponder indexer  ->  Postgres
#   ->  the real API  ->  the real Next.js app  ->  Playwright.
#
# It needs: Foundry (anvil, forge, cast), Postgres 16 with createdb/dropdb/psql, pnpm, Node 22+, Google Chrome, and a
# checkout of the contracts repo next to this one (or CONTRACTS_DIR). It touches only its own database (vezta_e2e) and its
# own ports, checks they are free first, and stops everything it started on exit. Your own dev servers are left alone.
#
# Not in CI yet: the contracts live in a separate repository, so a CI job would have to check that out and fork a
# public RPC. That is a decision for whoever wires CI, not something to guess at here.
#
#   ./scripts/e2e.sh                      (everything)
#   ./scripts/e2e.sh -g "create, buy"     (extra arguments go to Playwright)
#   E2E_HOLD=1800 ./scripts/e2e.sh trading  (then leave the stack running for 30 minutes)
#   ANVIL_PORT=8600 WEB_PORT=3200 API_PORT=3201 ./scripts/e2e.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS="${CONTRACTS_DIR:-$ROOT/../EVM-Pumpfun-Smart-Contract}"
ANVIL_PORT="${ANVIL_PORT:-8555}"
API_PORT="${API_PORT:-3101}"
WEB_PORT="${WEB_PORT:-3100}"
PONDER_PORT="${PONDER_PORT:-42071}"
REDIS_PORT="${REDIS_PORT:-6391}" # never 6379: that is a developer's own Redis
DB="${E2E_DB:-vezta_e2e}"
DB_USER="$(whoami)"
DB_URL="postgresql://$DB_USER@localhost:5432/$DB"
RPC="http://127.0.0.1:$ANVIL_PORT"
LOGS="${E2E_LOG_DIR:-$(mktemp -d)}"
PIDS=()

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# Each service is started as `( cd ... && pnpm start ) &`, so $! is the SUBSHELL, and pnpm, tsx, next-server and ponder's
# workers are its descendants. Killing only the subshell leaves those running on their ports. Children go first: once a
# parent dies its children are re-parented and can no longer be found through it.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  local code=$?
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill_tree "$pid"; done
  # The Anvil is started by local-chain.sh, whose own cleanup can lose a race with being killed. Its command line names this
  # run's port, so it can be found and stopped precisely: no other process matches.
  pkill -f "anvil --fork-url .* --port $ANVIL_PORT" 2>/dev/null || true
  pkill -f "redis-server .*--port $REDIS_PORT" 2>/dev/null || true
  echo "logs: $LOGS"
  exit $code
}
trap cleanup EXIT

# --- pre-flight: everything it needs, and every port free, before anything starts ------------------------------------
for tool in anvil forge cast pnpm node redis-server redis-cli; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
PGBIN=""
for dir in "$(dirname "$(command -v psql 2>/dev/null || echo /nonexistent/psql)")" /usr/local/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@16/bin; do
  [ -x "$dir/createdb" ] && PGBIN="$dir" && break
done
[ -n "$PGBIN" ] || die "Postgres client tools (createdb, dropdb, psql) not found"
[ -d "$CONTRACTS" ] || die "contracts repo not found at $CONTRACTS (set CONTRACTS_DIR)"
[ -d "/Applications/Google Chrome.app" ] || command -v google-chrome >/dev/null || die "Google Chrome is not installed (Playwright uses it, so nothing is downloaded)"
for port in "$ANVIL_PORT" "$API_PORT" "$WEB_PORT" "$PONDER_PORT" "$REDIS_PORT"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then die "port $port is already in use; choose another with ANVIL_PORT / API_PORT / WEB_PORT / PONDER_PORT / REDIS_PORT"; fi
done

wait_for() { # wait_for "<what>" <seconds> <command...>
  local what="$1" seconds="$2"; shift 2
  for _ in $(seq 1 "$seconds"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  die "timed out after ${seconds}s waiting for $what (logs in $LOGS)"
}

# --- 1. a local fork of Sepolia with the launchpad deployed -----------------------------------------------------------
log "Starting an Anvil fork of Sepolia on :$ANVIL_PORT and deploying the launchpad"
rm -f "$ROOT/packages/deployments/local.json"
ANVIL_PORT="$ANVIL_PORT" CONTRACTS_DIR="$CONTRACTS" "$ROOT/scripts/local-chain.sh" > "$LOGS/chain.log" 2>&1 &
PIDS+=($!)
wait_for "the deployment file" 420 test -s "$ROOT/packages/deployments/local.json"
LAUNCHPAD="$(node -pe "require('$ROOT/packages/deployments/local.json').launchpad")"
echo "launchpad: $LAUNCHPAD"

# --- 2. real activity on it: one token taken all the way to Uniswap, one with three buys in a single block -------------
log "Creating a token and taking it through its whole life (buy, sell, graduate, migrate)"
(cd "$ROOT/examples/evm-flow" && DEPLOYMENT_FILE="$ROOT/packages/deployments/local.json" RPC_URL="$RPC" pnpm --silent flow) > "$LOGS/flow.log" 2>&1 \
  || { tail -20 "$LOGS/flow.log"; die "the lifecycle flow failed"; }
E2E_TOKEN="$(grep -m1 -oE 'token 0x[0-9a-fA-F]{40}' "$LOGS/flow.log" | awk '{print tolower($2)}')"
[ -n "$E2E_TOKEN" ] || die "could not read the token address from the flow output"
grep -q 'status=migrated' "$LOGS/flow.log" || die "the flow did not end with a migrated token"
echo "graduated token: $E2E_TOKEN"

log "Checking the app's off-chain quote maths against the contract"
(cd "$ROOT/examples/evm-flow" && DEPLOYMENT_FILE="$ROOT/packages/deployments/local.json" RPC_URL="$RPC" pnpm --silent verify:quote) > "$LOGS/verify-quote.log" 2>&1 \
  || { tail -20 "$LOGS/verify-quote.log"; die "the quote replica disagrees with the contract"; }
tail -1 "$LOGS/verify-quote.log"

log "Creating a token with three buys forced into one block"
E2E_SAME_BLOCK_TOKEN="$(cd "$ROOT/apps/indexer" && DEPLOYMENT=local RPC_URL="$RPC" pnpm --silent fixture:same-block | tail -1)"
case "$E2E_SAME_BLOCK_TOKEN" in 0x*) ;; *) die "the same-block fixture did not print a token address";; esac
echo "same-block token: $E2E_SAME_BLOCK_TOKEN"

# --- 3. a fresh database ------------------------------------------------------------------------------------------------
log "Creating database $DB"
"$PGBIN/dropdb" --if-exists "$DB" >/dev/null 2>&1
"$PGBIN/createdb" "$DB"
(cd "$ROOT/packages/app-db" && DATABASE_URL="$DB_URL" pnpm exec prisma migrate deploy > "$LOGS/migrate.log" 2>&1) || { tail "$LOGS/migrate.log"; die "prisma migrate failed"; }

# --- 4. the indexer ----------------------------------------------------------------------------------------------------
log "Starting the indexer"
(cd "$ROOT/apps/indexer" && DEPLOYMENT=local DATABASE_URL="$DB_URL" PONDER_RPC_URL_11155111="$RPC" PONDER_SCHEMA="e2e_$$" \
  pnpm start:views --port "$PONDER_PORT" > "$LOGS/indexer.log" 2>&1) &
PIDS+=($!)
# The two tokens the tests rely on, by address: other tokens exist too (the quote check makes one, the trading tests make more).
tokens_indexed() {
  [ "$("$PGBIN/psql" -d "$DB" -Atc "select count(*) from launchpad.token where address in ('$E2E_TOKEN', '$E2E_SAME_BLOCK_TOKEN')" 2>/dev/null)" = "2" ]
}
wait_for "the indexer to find both tokens" 120 tokens_indexed

# --- 4b. Redis and the bot: live updates and automatic migration ---------------------------------------------------------
log "Starting Redis on :$REDIS_PORT and the watcher/migration bot"
redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save "" --appendonly no --loglevel warning > "$LOGS/redis.log" 2>&1 &
PIDS+=($!)
wait_for "Redis" 30 redis-cli -p "$REDIS_PORT" ping
# The bot's wallet is its own, random, and holds only gas: never a well-known key.
BOT_KEY="$(cast wallet new | awk '/Private key/ {print $3}')"
BOT_ADDR="$(cast wallet address --private-key "$BOT_KEY")"
cast rpc anvil_setBalance "$BOT_ADDR" 0x8AC7230489E80000 --rpc-url "$RPC" >/dev/null # 10 ETH for gas
(cd "$ROOT/apps/bot" && DEPLOYMENT=local RPC_URL="$RPC" BOT_PRIVATE_KEY="$BOT_KEY" REDIS_URL="redis://127.0.0.1:$REDIS_PORT" POLL_MS=1000 \
  pnpm start > "$LOGS/bot.log" 2>&1) &
PIDS+=($!)
wait_for "the bot" 60 grep -q "watching" "$LOGS/bot.log"

# The admin's wallet, for the moderation tests: random like the bot's, never a well-known key. The API is told its address; the
# tests are given the key, so a test can act as the admin.
ADMIN_KEY="$(cast wallet new | awk '/Private key/ {print $3}')"
# The admin is who the app signs in: the wallet's TRADING wallet, derived from its signature of a fixed message (see lib/session/derive.ts),
# so that is the address the API is told. (A wallet signs deterministically, so the test's wallet derives the very same one.)
SESSION_MESSAGE="Vezta Launchpad — trading session v1"
ADMIN_SIGNATURE="$(cast wallet sign --private-key "$ADMIN_KEY" "$SESSION_MESSAGE")"
ADMIN_ADDR="$(cast wallet address --private-key "$(cast keccak "$ADMIN_SIGNATURE")")"

# --- 5. the API ----------------------------------------------------------------------------------------------------------
log "Starting the API on :$API_PORT"
# WEB_ORIGIN is the domain a sign-in message must name; PINNER=fake because there is no Pinata key here (and it pins nothing).
(cd "$ROOT/apps/api" && DATABASE_URL="$DB_URL" DEPLOYMENT=local PORT="$API_PORT" CORS_ORIGINS="http://localhost:$WEB_PORT" \
  WEB_ORIGIN="http://localhost:$WEB_PORT" PINNER=fake REDIS_URL="redis://127.0.0.1:$REDIS_PORT" \
  ADMIN_ADDRESSES="$ADMIN_ADDR" INDEXER_URL="http://localhost:$PONDER_PORT" pnpm start > "$LOGS/api.log" 2>&1) &
PIDS+=($!)
wait_for "the API" 60 curl -sf "http://localhost:$API_PORT/ready"

# --- 6. the web app ------------------------------------------------------------------------------------------------------
log "Building and starting the web app on :$WEB_PORT"
# The browser reads the chain through the fork directly (NEXT_PUBLIC_RPC_URL) and gets the launchpad's addresses from the
# same deployment file as everything else (DEPLOYMENT=local, read by next.config.ts).
# E2E_PRIVY_APP_ID (optional, public) turns Privy on in this build and runs e2e/privy.spec.ts; without it the app is the plain
# wallet app and the whole suite is what it always was. The Privy app must list http://localhost:$WEB_PORT as an allowed origin.
(cd "$ROOT/apps/web" && DEPLOYMENT=local NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" NEXT_PUBLIC_RPC_URL="$RPC" NEXT_PUBLIC_PRIVY_APP_ID="${E2E_PRIVY_APP_ID:-}" \
  pnpm exec next build > "$LOGS/web-build.log" 2>&1) \
  || { tail -20 "$LOGS/web-build.log"; die "the web build failed"; }
(cd "$ROOT/apps/web" && pnpm exec next start -p "$WEB_PORT" > "$LOGS/web.log" 2>&1) &
PIDS+=($!)
wait_for "the web app" 60 curl -sf "http://localhost:$WEB_PORT/sepolia"

# --- 7. the browser ------------------------------------------------------------------------------------------------------
log "Running the browser tests"
cd "$ROOT/apps/web"
E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_TOKEN="$E2E_TOKEN" E2E_SAME_BLOCK_TOKEN="$E2E_SAME_BLOCK_TOKEN" \
  E2E_LAUNCHPAD="$LAUNCHPAD" E2E_DATABASE_URL="$DB_URL" E2E_RPC_URL="$RPC" E2E_ADMIN_KEY="$ADMIN_KEY" E2E_API_URL="http://localhost:$API_PORT" E2E_PRIVY_APP_ID="${E2E_PRIVY_APP_ID:-}" \
  pnpm exec playwright test "$@" || STATUS=$?

# E2E_HOLD=<seconds> keeps the whole stack up after the tests, for poking at it by hand or with a script.
if [ -n "${E2E_HOLD:-}" ]; then
  echo "holding the stack for ${E2E_HOLD}s: web http://localhost:$WEB_PORT  api :$API_PORT  chain $RPC  (logs: $LOGS)"
  echo "E2E_TOKEN=$E2E_TOKEN E2E_SAME_BLOCK_TOKEN=$E2E_SAME_BLOCK_TOKEN E2E_LAUNCHPAD=$LAUNCHPAD E2E_DATABASE_URL=$DB_URL E2E_RPC_URL=$RPC E2E_BASE_URL=http://localhost:$WEB_PORT"
  sleep "$E2E_HOLD"
fi
exit "${STATUS:-0}"
