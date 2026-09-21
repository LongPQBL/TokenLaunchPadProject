import { Hono } from "hono";

// Ponder requires this file to exist. It deliberately has no routes: the app's API reads the
// `launchpad` views straight from Postgres (spec §3), so the indexer serves only what Ponder
// itself provides, notably /health and /ready, which the uptime monitor polls.
const app = new Hono();

export default app;
