import { serve } from "@hono/node-server";
import { loadDeployment } from "@vezta/deployments";
import { createApp } from "./app.js";
import { verifyEoaSignature, verifyWithChain } from "./auth/signature.js";
import { loadConfig } from "./config.js";
import { isDatabaseReady } from "./db.js";
import { startLoop } from "./loop.js";
import { resolvePending } from "./metadata/resolver.js";

const config = loadConfig();
const deployment = loadDeployment();
const app = createApp({
  corsOrigins: config.corsOrigins,
  ready: isDatabaseReady,
  launchpads: { [deployment.chainId]: deployment.launchpad },
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

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on :${info.port}`);
});
