import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineChain, type Address } from "viem";

/** Shape of deployments/<name>.json, written by the contracts repo's deploy script. */
export interface Deployment {
  chainId: number;
  launchpad: Address; // VeztaLaunchToken: curves, trading, migration, fees
  factory: Address; // TokenFactory: the only entry point to create tokens
  weth: Address; // wrapped native token used as the default quote
  uniswapV2Factory: Address;
  uniswapV2Router: Address;
  pairInitCodeHash: `0x${string}`;
  deployBlock: number; // start indexing from here
  deployedAt: number;
  owner: Address;
  feeRecipient: Address;
  gitCommit: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** DEPLOYMENT=sepolia (default) reads deployments/sepolia.json at the repo root. */
export function loadDeployment(): Deployment {
  const name = process.env.DEPLOYMENT ?? "sepolia";
  const file = process.env.DEPLOYMENT_FILE ?? path.resolve(here, "../../../deployments", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

export function chainFor(d: Deployment) {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  return defineChain({
    id: d.chainId,
    name: `chain-${d.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}
