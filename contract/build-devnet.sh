#!/bin/bash
# Build pour le WASM Devnet (ripple.github.io/xrpl-wasm-stdlib/ui/)
# Target: wasm32v1-none (Rust 1.89.0) — requis par le devnet officiel

set -e
cd "$(dirname "$0")/contract"

cargo +1.89.0 build --release --target wasm32v1-none

WASM_SRC="target/wasm32v1-none/release/my_contract.wasm"
WASM_DST="../my_contract_devnet.wasm"

cp "$WASM_SRC" "$WASM_DST"

SIZE=$(wc -c < "$WASM_DST")
echo ""
echo "✓ WASM devnet prêt : my_contract_devnet.wasm ($SIZE bytes)"
echo "  → Upload ce fichier sur https://ripple.github.io/xrpl-wasm-stdlib/ui/"
