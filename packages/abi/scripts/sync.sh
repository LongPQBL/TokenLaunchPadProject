#!/usr/bin/env bash
# Re-copy the typed ABI from the contracts repo. It is generated output (script/export-abi.sh there),
# never hand-edited: if a contract changes, run this rather than patching the file.
set -euo pipefail
SRC="${1:-../EVM-Pumpfun-Smart-Contract/abi}"
cp "$SRC/index.ts" "$(dirname "$0")/../src/index.ts"
echo "Synced ABI from $SRC"
