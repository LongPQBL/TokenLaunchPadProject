# evm-flow: runnable examples for the launchpad contracts

Small, verified TypeScript programs (viem) that show every call the frontend and backend make. They run against a local
fork of Sepolia; see [`docs/05-local-development.md`](../../docs/05-local-development.md) to start one and deploy.

```bash
pnpm install
pnpm flow             # create a token, quote, buy, sell, graduate, migrate, claim fees
pnpm verify:quote     # the off-chain price math equals the contract, to the wei
pnpm verify:siwe      # Sign-In With Ethereum: valid login accepted, forged ones rejected
pnpm verify:metadata  # shared form/metadata validation
pnpm bot:demo         # the migration bot migrates a curve that just completed
pnpm typecheck        # everything compiles against the real ABI (incl. wagmi hooks and the chart)
```

Set `DEPLOYMENT=<name>` (default `sepolia`) to read `deployments/<name>.json`, `RPC_URL` for the chain (default
`http://127.0.0.1:8545`), and `FUNDER_INDEX` for the Anvil account that funds the demo wallets (default 4).

| File | What it shows |
|---|---|
| `src/config.ts`, `src/clients.ts` | loading a deployment, viem clients, random demo wallets |
| `src/create.ts` | create a token, read its address from `TokenCreated` |
| `src/trade.ts` | quote, buy with ETH, approve and sell, slippage, reading the real amounts from `Trade` |
| `src/quote.ts` | exact off-chain replicas of the price math and "spend X ETH" |
| `src/graduate.ts` | buy the rest (clipped), `migrate`, read the Uniswap pool |
| `src/bot.ts`, `src/bot-demo.ts` | the migration bot: live, catch-up, idempotent |
| `src/siwe.ts` | Sign-In With Ethereum challenge and verification |
| `src/metadata.ts` | shared zod schemas for the create-token form and the IPFS JSON |
| `src/lib.ts` | curve helpers (status, progress, spot price) and `errorName` |
| `src/react/hooks.ts` | wagmi hooks: live quote, buy, sell, create |
| `src/react/wallet.ts` | Reown AppKit + wagmi setup |
| `src/react/chart.ts` | Lightweight Charts candlesticks |

The default Anvil mnemonic in `src/clients.ts` is public. Use it only on a local fork, never on a real network.
