#!/usr/bin/env bash
# Writes the lending deployment's config from docker/lending.env, on every `make run`:
#   /config/config.json    the web app's assets (WBTC, the principal asset), prices and links
#   /config/keeper-asset   the indexer's protocol fee keeper asset
# Collateral is WBTC (the chain's fee asset); the principal asset (USDT) is issued by the user in
# the Wharfedale web app, and its ticker and decimals are read from the chain.
# Runs in the node image (wharfedale-wallet).
set -euo pipefail

RPC=${RPC:-http://rpc0:18443}
PRINCIPAL_ASSET=$(printf '%s' "${PRINCIPAL_ASSET:-}" | tr -d '[:space:]' | tr 'A-F' 'a-f')
PROTOCOL_FEE_KEEPER_ASSET=$(printf '%s' "${PROTOCOL_FEE_KEEPER_ASSET:-}" | tr -d '[:space:]' | tr 'A-F' 'a-f')
EXPLORER_URL=${EXPLORER_URL:-http://localhost:8080}
FAUCET_URL=${FAUCET_URL:-$EXPLORER_URL/faucet}
WBTC_USD=${WBTC_USD:-100000}
PRINCIPAL_USD=${PRINCIPAL_USD:-1}

hex64() { printf '%s' "$1" | grep -qx '[0-9a-f]\{64\}'; }

if ! hex64 "$PRINCIPAL_ASSET"; then
  echo "lending setup: set PRINCIPAL_ASSET in docker/lending.env to your USDT's asset id" >&2
  echo "  (issue it in the Wharfedale web app, $EXPLORER_URL/assets)" >&2
  exit 1
fi
keeper=${PROTOCOL_FEE_KEEPER_ASSET:-$PRINCIPAL_ASSET}
if ! hex64 "$keeper"; then
  echo "lending setup: PROTOCOL_FEE_KEEPER_ASSET is not an asset id" >&2
  exit 1
fi

echo "lending setup: waiting for $RPC"
until wharfedale-wallet rpc --rpc "$RPC" getblockchaininfo >/dev/null 2>&1; do sleep 1; done
fee_asset=$(wharfedale-wallet rpc --rpc "$RPC" getblockchaininfo | grep -o '"fee_asset": *"[0-9a-f]\{64\}"' | grep -o '[0-9a-f]\{64\}')

# The principal's on-chain name (WFA1, set by the web app's Assets page).
if ! record=$(wharfedale-wallet rest --rpc "$RPC" "asset/$PRINCIPAL_ASSET" 2>/dev/null); then
  echo "lending setup: $PRINCIPAL_ASSET is not an issued asset on this chain" >&2
  exit 1
fi
field() { printf '%s' "$record" | tr -d '\n' | grep -o "\"$1\": *\(\"[^\"]*\"\|[0-9]*\)" | sed 's/.*: *//; s/"//g'; }
symbol=$(field ticker)
decimals=$(field precision)
symbol=${symbol:-USDT}
decimals=${decimals:-0}

cat >/config/config.json.tmp <<JSON
{
  "collateralAsset": { "id": "$fee_asset", "symbol": "WBTC", "decimals": 8 },
  "principalAsset": { "id": "$PRINCIPAL_ASSET", "symbol": "$symbol", "decimals": $decimals },
  "protocolFeeAsset": { "id": "$keeper", "symbol": "$symbol", "decimals": $decimals },
  "explorerUrl": "$EXPLORER_URL",
  "faucetUrl": "$FAUCET_URL",
  "pricesUsd": { "WBTC": $WBTC_USD, "$symbol": $PRINCIPAL_USD }
}
JSON
printf '%s\n' "$keeper" >/config/keeper-asset
mv /config/config.json.tmp /config/config.json
echo "lending setup: principal $symbol ($decimals decimals) $PRINCIPAL_ASSET, fee keeper $keeper"
