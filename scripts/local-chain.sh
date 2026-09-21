#!/usr/bin/env bash
# Bring up a local Sepolia fork with the launchpad deployed, and copy the deployment file here.
# The fork includes the real Uniswap V2, so graduation and migration work end to end.
#
# Runs in the foreground until interrupted (Ctrl-C stops Anvil). The deployment is written to
# packages/deployments/local.json, which is gitignored: it differs on every run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS="${CONTRACTS_DIR:-$HERE/../EVM-Pumpfun-Smart-Contract}"
# Pocket Network answers every state read the fork needs, steadily (about 0.75 s a call); publicnode is quicker but drops requests under
# the load a fork makes. Either can be chosen with SEPOLIA_RPC_URL.
RPC="${SEPOLIA_RPC_URL:-https://eth-sepolia-testnet.api.pocket.network}"
PORT="${ANVIL_PORT:-8545}"

# A public RPC drops requests when the fork asks for a lot of state at once: retry generously (and wait longer for an answer) instead of failing.
anvil --fork-url "$RPC" --port "$PORT" --retries 20 --fork-retry-backoff 1000 --timeout 120000 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT

until cast block-number --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1; do sleep 1; done

# Account 4 funds the deploy. Never account 0, and never an Anvil address as owner or feeRecipient:
# bots put EIP-7702 sweeper delegations on the well-known keys and a fork inherits them, so fees
# paid to one would vanish. deploy/local.json in the contracts repo uses a throwaway address.
K4=$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 4)
# forge loads a .env from the directory it runs in, and the contracts repo's .env is for deploying to a real network (a keystore, a
# real RPC, DEPLOY_CONFIG=sepolia): it must not leak into this local deploy. So forge runs from a directory with none, and is
# pointed at the contracts with --root.
(
  cd "$(mktemp -d)"
  DEPLOY_CONFIG=local GIT_COMMIT=local \
    forge script "$CONTRACTS/script/Deploy.s.sol" --root "$CONTRACTS" --rpc-url "http://127.0.0.1:$PORT" --private-key "$K4" --broadcast
)
cp "$CONTRACTS/deployments/local.json" "$HERE/packages/deployments/local.json"

echo "Local chain ready on :$PORT. Deployment copied to packages/deployments/local.json"
wait $ANVIL_PID
