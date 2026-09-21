# ponder-indexer: reference indexer for the launchpad

Turns the contracts' events into Postgres tables and a read API (REST, GraphQL, SQL). Built with
[Ponder](https://ponder.sh) 0.17. See [`docs/04-backend-guide.md`](../../docs/04-backend-guide.md) for the design.

```bash
pnpm install
PONDER_RPC_URL_11155111=<rpc url> pnpm dev        # reads ../../deployments/sepolia.json
curl "http://localhost:42069/tokens?limit=5"
```

`DEPLOYMENT=<name>` picks another `deployments/<name>.json`; the RPC variable suffix is the chain id.
For production use Postgres (`DATABASE_URL`) and `pnpm start`. `ponder dev` does not hot-reload schema changes: restart it.
