import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * The browser needs the launchpad addresses, and there is exactly one place they live: packages/deployments/<name>.json,
 * which the indexer and the API read too. The name comes from $DEPLOYMENT, as it does for them. Only the four fields
 * the app uses are handed to the browser. A build without the file still works; trading then says it is not configured.
 */
function browserDeployment(): string | undefined {
  const name = process.env.DEPLOYMENT ?? "local";
  const file = path.resolve(process.cwd(), "../../packages/deployments", `${name}.json`);
  if (!existsSync(file)) {
    console.warn(`[web] no deployment file at ${file}: trading will be shown as not configured`);
    return undefined;
  }
  const { chainId, launchpad, factory, weth } = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  return JSON.stringify({ chainId, launchpad, factory, weth });
}

const deployment = browserDeployment();

const config: NextConfig = {
  // Where the build is written. A build overwrites the files a running server reads, so the demo (scripts/demo-sepolia.sh) builds into a
  // folder of its own and the browser tests' builds cannot pull the scripts out from under it.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into this folder on every start: files nobody wrote, and not for the repo.
  agentRules: false,
  // Workspace packages are shipped as TypeScript source, so Next has to compile them.
  transpilePackages: ["@vezta/shared", "@vezta/abi"],
  env: deployment ? { NEXT_PUBLIC_DEPLOYMENT: deployment } : {},
};

export default config;
