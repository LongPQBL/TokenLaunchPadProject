import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { and, client, desc, eq, graphql, gt, sql } from "ponder";

const app = new Hono();

// Built-in APIs: GraphQL for flexible reads, /sql/* for the typed SQL-over-HTTP client.
app.use("/graphql", graphql({ db, schema }));
app.use("/sql/*", client({ db, schema }));

// bigint values are returned as strings: JSON cannot carry them safely.
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

/** GET /tokens?sort=new|volume|progress&limit=50 : the home page list. */
app.get("/tokens", async (c) => {
  const sort = c.req.query("sort") ?? "new";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const order =
    sort === "volume" ? desc(schema.token.volumeQuote) : sort === "progress" ? desc(schema.token.progressBps) : desc(schema.token.createdAt);
  return c.json(json(await db.select().from(schema.token).orderBy(order).limit(limit)));
});

/** GET /tokens/:address : the token page header. */
app.get("/tokens/:address", async (c) => {
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const [row] = await db.select().from(schema.token).where(eq(schema.token.address, address)).limit(1);
  return row ? c.json(json(row)) : c.json({ error: "not_found" }, 404);
});

/** GET /tokens/:address/trades?limit=50 : the live trades feed. */
app.get("/tokens/:address/trades", async (c) => {
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db.select().from(schema.trade).where(eq(schema.trade.token, address)).orderBy(desc(schema.trade.blockNumber)).limit(limit);
  return c.json(json(rows));
});

/** GET /tokens/:address/holders : top holders, excluding the curve itself and the pool. */
app.get("/tokens/:address/holders", async (c) => {
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const [t] = await db.select().from(schema.token).where(eq(schema.token.address, address)).limit(1);
  const rows = await db
    .select()
    .from(schema.balance)
    .where(and(eq(schema.balance.token, address), gt(schema.balance.amount, 0n)))
    .orderBy(desc(schema.balance.amount))
    .limit(50);
  const hidden = new Set([t?.pair?.toLowerCase()]);
  return c.json(json(rows.filter((r) => !hidden.has(r.holder.toLowerCase()))));
});

/**
 * GET /tokens/:address/candles?interval=60 : OHLC candles for the chart, built from trades.
 * The price of a trade is the SPOT price right after it (virtual quote / virtual token), not the average price
 * paid: one huge buy would otherwise print a misleading average instead of where the price really ended.
 */
app.get("/tokens/:address/candles", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const interval = Math.max(Number(c.req.query("interval") ?? 60), 1);
  // price = raw quote units per whole token (18 decimals), as decimal text to keep full precision
  const result = await db.execute(sql`
    SELECT
      (floor(timestamp::numeric / ${interval}) * ${interval})::bigint AS time,
      (array_agg(virtual_quote_reserves * 1000000000000000000 / virtual_token_reserves ORDER BY timestamp, id))[1]::text AS open,
      max(virtual_quote_reserves * 1000000000000000000 / virtual_token_reserves)::text AS high,
      min(virtual_quote_reserves * 1000000000000000000 / virtual_token_reserves)::text AS low,
      (array_agg(virtual_quote_reserves * 1000000000000000000 / virtual_token_reserves ORDER BY timestamp DESC, id DESC))[1]::text AS close,
      sum(quote_amount)::text AS volume
    FROM trade
    WHERE token = ${address}
    GROUP BY 1
    ORDER BY 1
  `);
  return c.json(json(result.rows));
});

export default app;
