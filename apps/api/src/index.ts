import { serve } from "@hono/node-server";
import { loadDeployment } from "@vezta/deployments";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { isDatabaseReady } from "./db.js";

const config = loadConfig();
const deployment = loadDeployment();
const app = createApp({
  corsOrigins: config.corsOrigins,
  ready: isDatabaseReady,
  launchpads: { [deployment.chainId]: deployment.launchpad },
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on :${info.port}`);
});
