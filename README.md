# Simplicity lending on Wharfedale

A peer-to-peer lending protocol written in SimplicityHL, ported from
[BlockstreamResearch/simplicity-lending](https://github.com/BlockstreamResearch/simplicity-lending)
(Liquid) to [Wharfedale](https://github.com/WharfedaleBTC/wharfedale).

## How it works

Borrowers create offers with a collateral amount (WBTC, the chain's fee asset), the principal
they want (USDT, an asset issued on the chain), an interest rate and an expiry. Before an offer is
accepted the borrower can cancel it. A lender accepts it by supplying the principal, which
locks the collateral in the Lending covenant. Before the expiry the borrower repays principal
plus interest and takes the collateral back; after it, if the loan is unpaid, the lender
liquidates and takes the collateral.

Loans expire at a **unix time** (`jet::check_lock_time`), not a block height: Wharfedale makes
blocks only when there is work, so heights don't measure time. Wharfedale checks time locks
against the block's own timestamp, so a liquidation is admitted as soon as the expiry has
passed and makes the next block itself.

## What changed from Liquid

| Upstream (Liquid) | Here (Wharfedale) |
|---|---|
| `smplx-sdk` 0.0.5 (Liquid networks, P2WPKH wallets, SimplicityHL 0.5) | `crates/sdk` (`lending-sdk`): Taproot key-path wallets, Wharfedale's fee asset and genesis hash, SimplicityHL 0.9 as the node |
| Contract tests on an elementsd regtest | The same tests on an in-process chain validated by Wharfedale's own consensus code (`wharfedale-ledger`) |
| Web wallet: LWK (Jade, SideSwap, Humid, Waterfalls) | A recovery-phrase wallet with the Wharfedale web app's keys; the browser runs `crates/wasm` (WebAssembly) to compile programs, unblind, fund, blind, sign and satisfy covenants |
| `check_lock_height`, terms in ~1-minute blocks | `check_lock_time`, terms in seconds |
| Liquid asset registry (ELIP-0100) | Not used: the lending NFTs are issued without a contract |
| Prices from Blockstream's price API | WBTC at the live BTC/USD price (Coinbase, fetched by the browser); the principal's price from the deployment's config |

## Repository

- `crates/contracts`: the `.simf` programs and their transaction builders.
- `crates/sdk`: programs with storage leaves, transaction assembly, the signer, a node provider
  and the in-process test chain.
- `crates/indexer`: indexes offers from a Wharfedale node and serves the API the web app uses.
- `crates/session`: the loan flows (create, accept, repay, cancel, liquidate) over the indexer.
- `crates/cli`: a helper CLI (`NODE_URL`, `MNEMONIC`).
- `crates/wasm`: the transaction layer for the browser.
- `crates/e2e`: the loan lifecycle against a running network (`make e2e`).
- `web/`: the React app.
- `docker/`: images and the local stack.

The workspace builds against sibling checkouts, laid out as the node expects:

```text
wharfedale/          the node (its ledger crate checks the contract tests)
wharfedale-sdk-rs/   the Rust SDK
malachite/           the node's consensus fork
simplicity-lending/  this repository
```

## Run it locally

```bash
cd ../wharfedale && make run     # the Wharfedale network, its web app and faucet (:8080)
cd ../simplicity-lending && make run   # indexer, API, web app (:8090)
```

Collateral is WBTC, the chain's fee asset. The principal is an asset you issue yourself: in the
Wharfedale web app (http://localhost:8080/assets) create USDT, then put its asset id in
`docker/lending.env`:

```bash
PRINCIPAL_ASSET=<the USDT asset id>
```

Its ticker and decimals come from the chain. `PROTOCOL_FEE_KEEPER_ASSET` (optional) is the
asset whose holder collects protocol fees; it defaults to the principal asset, as upstream. The
settings apply on the next `make stop` and `make run`.

Open http://localhost:8090 and create a wallet, or import the Wharfedale web app's (recovery
phrase or key file); wallets stay in the browser. Get WBTC from the faucet at
http://localhost:8080/faucet and send USDT to lenders from the wallet that issued it.

`make stop` keeps the indexer's database; `make clear` deletes it.

CI publishes the images `ghcr.io/wharfedalebtc/lending-indexer` (the indexer, the API, the
database migrations and the config job `lending-setup`) and `ghcr.io/wharfedalebtc/lending-web`;
the demo deployment ([demo-prod](https://github.com/WharfedaleBTC/demo-prod)) runs them.

## Tests

```bash
make test   # unit, contract (in-process chain), indexer and session tests (Postgres: DATABASE_URL)
make e2e    # repay and liquidation against the running network and indexer
```

For `pnpm dev` in `web/`: `make wasm` builds the WebAssembly module (in Docker) and
`make dev-config` copies the running deployment's `config.json` into `web/public`.
