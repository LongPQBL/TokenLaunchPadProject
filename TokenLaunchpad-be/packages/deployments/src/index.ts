import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";

/** Shape of deployments/<name>.json, written by the contracts repo's deploy script. */
export interface Deployment {
  chainId: number;
  launchpad: Address; // VeztaLaunchToken: curves, trading, migration, fees
  factory: Address; // TokenFactory: the only entry point to create tokens
  weth: Address; // wrapped native token, the default quote
  uniswapV2Factory: Address;
  uniswapV2Router: Address;
  pairInitCodeHash: `0x${string}`;
  deployBlock: number; // start indexing here; never scan from block 0
  deployedAt: number;
  owner: Address;
  feeRecipient: Address;
  gitCommit: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads packages/deployments/<name>.json. `name` defaults to $DEPLOYMENT, then "local".
 *
 * Adding a chain is a new file here plus an entry in packages/shared's chain config; nothing else
 * in the app reads an address from anywhere but this function.
 */
export function loadDeployment(name = process.env.DEPLOYMENT ?? "local"): Deployment {
  const file = path.resolve(here, "..", `${name}.json`);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `No deployment file at ${file}. For a local chain run scripts/local-chain.sh; for a real network ` +
          `copy the contracts repo's deployments/${name}.json here.`,
      );
    }
    throw e;
  }
  return JSON.parse(raw) as Deployment;
}
