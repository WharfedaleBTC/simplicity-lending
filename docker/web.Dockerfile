# Lending web app: the Wharfedale transaction layer compiled to WebAssembly, the Vite app, nginx.
# Build context: the folder holding simplicity-lending/, wharfedale/, wharfedale-sdk-rs/ and
# malachite/ (the lending workspace builds against the node's ledger and SDK by path):
#   docker build -f simplicity-lending/docker/web.Dockerfile -t lending-web:dev .
# `--target wasm-pkg --output type=local,dest=…` exports just the WebAssembly package (for `pnpm dev`).

FROM rust:1-bookworm AS wasm
# Apple's and Debian's default toolchains differ: Debian's clang targets WebAssembly (secp256k1-zkp
# and the Simplicity C library are compiled for it).
RUN apt-get update && apt-get install -y --no-install-recommends clang llvm \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add wasm32-unknown-unknown
# Same version as the `wasm-bindgen` crate (crates/wasm/Cargo.toml).
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-bindgen-cli --version 0.2.100 --locked
WORKDIR /src
COPY malachite /src/malachite
COPY wharfedale /src/wharfedale
COPY wharfedale-sdk-rs /src/wharfedale-sdk-rs
COPY simplicity-lending/Cargo.toml simplicity-lending/Cargo.lock /src/simplicity-lending/
COPY simplicity-lending/crates /src/simplicity-lending/crates
WORKDIR /src/simplicity-lending
ENV CC_wasm32_unknown_unknown=clang AR_wasm32_unknown_unknown=llvm-ar
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/simplicity-lending/target \
    cargo build --profile wasm --locked --target wasm32-unknown-unknown -p lending-wasm \
 && wasm-bindgen --target web --out-dir /pkg target/wasm32-unknown-unknown/wasm/lending_wasm.wasm

FROM scratch AS wasm-pkg
COPY --from=wasm /pkg /

FROM node:22-bookworm AS web
WORKDIR /app/web
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY simplicity-lending/web/package.json simplicity-lending/web/pnpm-lock.yaml simplicity-lending/web/.pnpmfile.cjs ./
# .pnpmfile.cjs checks the WebAssembly module is there.
COPY --from=wasm /pkg ./src/wasm/pkg
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY simplicity-lending/web ./
COPY --from=wasm /pkg ./src/wasm/pkg
# The app compiles these at runtime (WebAssembly) and derives program ids from them.
COPY simplicity-lending/crates/contracts/simf /app/crates/contracts/simf
ARG VITE_API_URL=/api
ARG VITE_ESPLORA_BASE_URL=/esplora
ARG VITE_DEMO_MODE=true
ENV VITE_API_URL=$VITE_API_URL VITE_ESPLORA_BASE_URL=$VITE_ESPLORA_BASE_URL VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN pnpm build

FROM nginx:1.27-alpine
COPY --from=web /app/web/dist /usr/share/nginx/html
# Rendered by the image's entrypoint with NODE_UPSTREAM and API_UPSTREAM.
COPY simplicity-lending/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NODE_UPSTREAM=http://rpc0:18443 API_UPSTREAM=http://api:8000
EXPOSE 80
