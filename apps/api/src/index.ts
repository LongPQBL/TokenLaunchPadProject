import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { isDatabaseReady } from "./db.js";

const config = loadConfig();
const app = createApp({ corsOrigins: config.corsOrigins, ready: isDatabaseReady });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on :${info.port}`);
});
