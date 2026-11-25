# Simplicity Lending Web

V2 frontend scaffold for the Simplicity Lending protocol.

## Prerequisites

- Node.js 20.19+
- pnpm 10+

## Configuration

Build time (`.env`): `VITE_API_URL` (indexer API, default `/api`), `VITE_ESPLORA_BASE_URL` (a
Wharfedale node's Esplora API, default `/esplora`), `VITE_DEMO_MODE` (short loan terms).

Runtime: `/config.json`, the deployment's assets (WBTC, USDT, the protocol fee keeper), prices
and the faucet link. In Docker the setup job writes it; for `pnpm dev` run `make dev-config`
in the repository root.

Prices (for LTV and USD figures only): the browser fetches WBTC's from Coinbase's public BTC/USD
spot price every 30 seconds and falls back to the config's when that fails.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 (token-ready theme scaffold)
- HeroUI (`@heroui/react`)
- React Router v7 (protected route stub)
- React Query v5
- Zod v3
- ESLint + Prettier

## Install

The app runs the lending transaction layer (`crates/wasm`) as WebAssembly. From the repository
root:

```bash
make wasm          # builds web/src/wasm/pkg in Docker
cd web && pnpm install --ignore-scripts
pnpm dev           # with `make run` up: proxies /api and /esplora (see vite.config.ts)
```

## Run

```bash
pnpm dev
```

## Add Icon

Generate a new icon component in `src/components/icons`.

Command:

```bash
pnpm add-icon <icon-name> "<svg>...</svg>"
```

Example:

```bash
pnpm add-icon coins "<svg viewBox='0 0 24 24'>...</svg>"
```

Notes:

- If SVG content is omitted, the script reads SVG from your clipboard.
- The generated component is normalized to use `currentColor` and saved as `<name>-icon.tsx`.

## Lint

```bash
pnpm lint
```

## Docker

`docker/web.Dockerfile` (the WebAssembly module, this app, nginx); `make run` in the repository
root starts it with the indexer.
