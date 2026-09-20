import type { Server } from "node:http";
import { serve } from "@hono/node-server";
import { loadDeployment } from "@vezta/deployments";
import { CHAINS } from "@vezta/shared";
import { createApp } from "./app.js";
import { verifyEoaSignature, verifyWithChain } from "./auth/signature.js";
import { loadConfig } from "./config.js";
import { isDatabaseReady } from "./db.js";
import { startLoop } from "./loop.js";
import { fakePinner, pinataPinner } from "./metadata/pin.js";
import { resolvePending } from "./metadata/resolver.js";
import { attachRealtime } from "./realtime/server.js";

const config = loadConfig();
const deployment = loadDeployment();
const app = createApp({
  corsOrigins: config.corsOrigins,
  ready: isDatabaseReady,
  launchpads: { [deployment.chainId]: deployment.launchpad },
  pinner: config.pinner === "pinata" ? pinataPinner(config.pinataJwt!) : config.pinner === "fake" ? fakePinner() : undefined,
  auth: {
    domain: new URL(config.webOrigin).host,
    uri: config.webOrigin,
    chainId: deployment.chainId,
    verify: config.rpcUrl ? verifyWithChain(config.rpcUrl) : verifyEoaSignature,
    trustProxy: config.trustProxy,
  },
});

// Resolves token metadata (name, image, links) from IPFS into the app schema, a few seconds behind the indexer.
// Safe to run in every API instance: the resolver claims rows with a compare-and-set lease.
startLoop(() => resolvePending({ gateway: config.ipfsGatewayUrl }), 5_000);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on :${info.port}`);
});

// Live updates: this instance subscribes to what the watcher publishes and delivers to the browsers connected to it.
if (config.redisUrl) {
  attachRealtime(server as Server, { redisUrl: config.redisUrl, corsOrigins: config.corsOrigins, chains: Object.keys(CHAINS) });
} else {
  console.warn("REDIS_URL is not set: no live updates, pages will poll");
}
