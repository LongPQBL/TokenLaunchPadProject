# TokenLaunchPadProject

Vezta token launchpad: token creation, bonding-curve trading and live charts on EVM chains (Sepolia today). The contracts are in a separate
repository, [Vezta-contract-tokenLaunchpad](https://github.com/LongPQBL/Vezta-contract-tokenLaunchpad); this repository is the app on top of them.

## Layout

Everything of the project is in one of two folders, by what it is. The root holds only the workspace's own configuration.

| Folder | What is in it |
|---|---|
| `TokenLaunchpad-fe/` | **The frontend.** The Next.js app is the root of this folder: `app/`, `components/`, `lib/`, `e2e/`, `test/`, `.env.example`. Also `spikes/` (browser experiments). |
| `TokenLaunchpad-be/` | **The backend and what both sides share.** `apps/api` (Hono + Postgres), `apps/indexer` (Ponder), `apps/bot` (live events and migration). `packages/shared` (curve maths, strings, chain config), `packages/abi`, `packages/deployments`, `packages/app-db` (Prisma). `abi/` and `deployments/` (what the contracts repo exports), `examples/`, `tools/`, `scripts/` (run the whole stack), `docs/` (written, not committed). |
| `*/legacy-solana/` | The earlier Solana backend and frontend, kept for reference; not part of the build, lint or tests. |
| root | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.github/`. |

The frontend depends on the backend's `packages/*` (one way: the frontend imports the shared code, the backend never imports the frontend).

## Working locally

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test                    # every package
TokenLaunchpad-be/scripts/demo-sepolia.sh                   # the whole app on this machine, against the deployed Sepolia launchpad
TokenLaunchpad-be/scripts/e2e.sh                            # a local fork of Sepolia, the whole stack, and the browser tests
```

Node 22+, pnpm, Postgres 16 and Redis are needed; the scripts say what else and check first. The e2e and demo scripts start their own database,
Redis and ports and never touch yours.

## Configuration

Settings come from the environment. Each deployable has a `.env.example` that lists **every** variable it reads (a test keeps the two in step);
copy it to `.env` (backend) or `.env.local` (frontend) and fill it in. The copies are git-ignored; only `.env.example` is committed.

| Where | File | Holds |
|---|---|---|
| `TokenLaunchpad-be/apps/api/` | `.env` | database, ports and origins, IPFS gateway, **`PINATA_JWT`** (secret), admin addresses |
| `TokenLaunchpad-be/apps/bot/` | `.env` | RPC, Redis, **`BOT_PRIVATE_KEY`** (secret: the bot's own wallet) |
| `TokenLaunchpad-be/apps/indexer/` | `.env` | deployment, RPC per chain, database, Ponder schema |
| `TokenLaunchpad-be/packages/app-db/` | `.env` | `DATABASE_URL` for Prisma's migrations |
| `TokenLaunchpad-fe/` | `.env.local` | the API and RPC addresses, Privy and WalletConnect IDs, the deployment to build for |

Two rules. **Secrets stay in the backend**: anything called `NEXT_PUBLIC_` is written into the page every visitor downloads, so it is an address
or an ID, never a key (a test refuses a `NEXT_PUBLIC_` name that looks like one). **A setting with a default writes it down once**: the API's
IPFS gateway is `DEFAULT_IPFS_GATEWAY`, the backend's address for the frontend is `lib/backend-url.ts`.

Never commit real keys: `.env*` (except `.env.example`) and `id.json` are git-ignored.

## Not included in this repository

`TokenLaunchpad-fe/legacy-solana/public/libraries/` (the TradingView Charting Library, about 15 MB) is git-ignored on purpose: it is proprietary and
needs its own licence from TradingView. The current chart uses the open-source [Lightweight Charts](https://github.com/tradingview/lightweight-charts).
