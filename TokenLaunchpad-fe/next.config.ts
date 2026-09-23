import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * The browser needs the launchpad addresses, and there is exactly one place they live: TokenLaunchpad-be/packages/deployments/<name>.json,
 * which the indexer and the API read too. The name comes from $DEPLOYMENT, as it does for them. Only the four fields
 * the app uses are handed to the browser. A build without the file still works; trading then says it is not configured.
 */
function browserDeployment(): string | undefined {
  const name = process.env.DEPLOYMENT ?? "local";
  const file = path.resolve(process.cwd(), "..", "TokenLaunchpad-be/packages/deployments", `${name}.json`);
  if (!existsSync(file)) {
    console.warn(`[web] no deployment file at ${file}: trading will be shown as not configured`);
    return undefined;
  }
  const { chainId, launchpad, factory, weth } = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return JSON.stringify({ chainId, launchpad, factory, weth });
}

const deployment = browserDeployment();

const config: NextConfig = {
  // Where the build is written. A build overwrites the files a running server reads, so the demo (TokenLaunchpad-be/scripts/demo-sepolia.sh) builds into a
  // folder of its own and the browser tests' builds cannot pull the scripts out from under it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into this folder on every start: files nobody wrote, and not for the repo.
  agentRules: false,
  // Workspace packages are shipped as TypeScript source, so Next has to compile them.
  transpilePackages: ["@vezta/shared", "@vezta/abi"],
  env: deployment ? { NEXT_PUBLIC_DEPLOYMENT: deployment } : {},
  // The session cookie is SameSite=Lax, so it only survives if the site and the API are one registrable domain. A Vercel site and an API
  // on another host are not, so the browser calls the site's own /api-proxy and Next forwards it to API_PROXY_TARGET (set NEXT_PUBLIC_API_URL
  // to <the site>/api-proxy). Off unless the target is set. A websocket cannot go through a rewrite: NEXT_PUBLIC_WS_URL names its server.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.trim().replace(/\/+$/, "");
    return target ? [{ source: "/api-proxy/:path*", destination: `${target}/:path*` }] : [];
  },
};

export default config;
