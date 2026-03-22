FROM rust:alpine AS builder

WORKDIR /contract

RUN rustup target add wasm32v1-none

# Copy manifests first so dependency downloads are cached as a separate layer
COPY Cargo.toml Cargo.lock ./

# Pre-fetch dependencies with a stub lib (avoids re-downloading on source changes)
RUN mkdir -p src && \
    printf '#![cfg_attr(target_arch = "wasm32", no_std)]\n#[no_mangle]\npub extern "C" fn finish() -> i32 { 0 }\n' > src/lib.rs && \
    cargo fetch && \
    cargo build --target wasm32v1-none --release 2>/dev/null || true && \
    rm -rf src target/wasm32v1-none/release/deps/my_contract* target/wasm32v1-none/release/my_contract*

# Copy real source and compile
COPY src/ ./src/
RUN cargo build --target wasm32v1-none --release

# ── Runtime stage: tiny image that just copies the .wasm to the shared volume ──
FROM alpine:3.19

COPY --from=builder /contract/target/wasm32v1-none/release/my_contract.wasm /wasm/my_contract_devnet.wasm

CMD ["cp", "/wasm/my_contract_devnet.wasm", "/output/my_contract_devnet.wasm"]
