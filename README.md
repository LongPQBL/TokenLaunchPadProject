# TokenLaunchPadProject

Web app for the Vezta token launchpad: token creation, bonding-curve trading and live charts.

| Folder | What it is |
|---|---|
| `Solana-Pumpfun-Backend/` | Express + MongoDB API and Socket.IO server (currently the Solana version, from an open-source pump.fun clone) |
| `Solana-Pumpfun-Frontend/` | Next.js web app (currently the Solana version) |

The on-chain part for EVM chains lives in a separate repository:
[Vezta-contract-tokenLaunchpad](https://github.com/LongPQBL/Vezta-contract-tokenLaunchpad).
The plan is to adapt this backend and frontend to those contracts; see `docs/` for the proposed stack and the
integration guides.

## Working locally

Each folder is an independent Node project. Copy `.env.example` to `.env` (backend) or `.env.local` (frontend),
fill in your own values, then follow the commands in that folder's README. Never commit real keys: `.env*` files
and `id.json` are git-ignored.

## Not included in this repository

`Solana-Pumpfun-Frontend/public/libraries/` (the TradingView Charting Library and its datafeed samples, about
15 MB) is git-ignored on purpose: it is proprietary and needs its own licence from TradingView. The frontend chart
will not render from a fresh clone until you add it yourself, or replace it with an open-source chart such as
[Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0).
