#!/usr/bin/env bash
# Copy compiled MultiVesting + MockUSDT artifacts from tonpass-smartcontract into shared/artifacts/.
# Rerun when the contract changes (run `npx hardhat compile` in ../tonpass-smartcontract/bsc first).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$ROOT/../tonpass-smartcontract/bsc/artifacts/contracts}"
mkdir -p "$ROOT/shared/artifacts"
cp "$SRC/MultiVesting.sol/MultiVesting.json" "$ROOT/shared/artifacts/MultiVesting.json"
cp "$SRC/mocks/MockUSDT.sol/MockUSDT.json" "$ROOT/shared/artifacts/MockUSDT.json"
echo "Synced artifacts into $ROOT/shared/artifacts"
