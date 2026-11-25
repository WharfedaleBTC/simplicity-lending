# Lending indexer (RUN_MODE=indexer) and its API (RUN_MODE=api). The image also runs the
# deployment's one-shot jobs: `sqlx migrate run --source /migrations` (the database) and
# `lending-setup` (docker/setup.sh: the web app's /config). Build context: the folder holding simplicity-lending/, wharfedale/,
# wharfedale-sdk-rs/ and malachite/ (the lending workspace builds against the node's crates):
#   docker build -f simplicity-lending/docker/indexer.Dockerfile -t lending-indexer:dev .

FROM rust:1-bookworm AS build
WORKDIR /src
COPY malachite /src/malachite
COPY wharfedale /src/wharfedale
COPY wharfedale-sdk-rs /src/wharfedale-sdk-rs
COPY simplicity-lending/Cargo.toml simplicity-lending/Cargo.lock /src/simplicity-lending/
COPY simplicity-lending/.sqlx /src/simplicity-lending/.sqlx
COPY simplicity-lending/crates /src/simplicity-lending/crates
WORKDIR /src/simplicity-lending
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/simplicity-lending/target \
    SQLX_OFFLINE=true cargo build --release --locked -p lending-indexer --bin simplicity-lending-indexer \
 && cp target/release/simplicity-lending-indexer /usr/local/bin/

FROM rust:1-bookworm AS sqlx
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install --locked sqlx-cli --version 0.8.6 --no-default-features --features rustls,postgres

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && useradd --system --create-home --uid 10001 appuser
WORKDIR /app
COPY --from=build /usr/local/bin/simplicity-lending-indexer /usr/local/bin/
COPY simplicity-lending/crates/indexer/configuration /app/configuration
COPY --from=sqlx /usr/local/cargo/bin/sqlx /usr/local/bin/sqlx
COPY simplicity-lending/crates/indexer/migrations /migrations
COPY --chmod=755 simplicity-lending/docker/setup.sh /usr/local/bin/lending-setup
USER appuser
ENV APP_ENVIRONMENT=production
# The protocol fee keeper asset comes from the setup job (/config/keeper-asset) unless set.
CMD ["sh", "-c", "[ -n \"$INDEXER__PROTOCOL_FEE_KEEPER_ASSET_ID\" ] || export INDEXER__PROTOCOL_FEE_KEEPER_ASSET_ID=$(cat /config/keeper-asset); exec simplicity-lending-indexer"]
