import { readFileSync } from "node:fs";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "../../abi/index.ts";

// One deployments/<name>.json per chain, written by the contracts repo's deploy script.
const name = process.env.DEPLOYMENT ?? "sepolia";
const d = JSON.parse(readFileSync(new URL(`../../deployments/${name}.json`, import.meta.url), "utf8"));

export default createConfig({
  chains: {
    // Ponder reads PONDER_RPC_URL_<chainId>; add a second chain here for Base Sepolia later.
    main: { id: d.chainId, rpc: process.env[`PONDER_RPC_URL_${d.chainId}`] ?? "http://127.0.0.1:8545" },
  },
  contracts: {
    Launchpad: { abi: launchpadAbi, chain: "main", address: d.launchpad, startBlock: d.deployBlock },
    Factory: { abi: tokenFactoryAbi, chain: "main", address: d.factory, startBlock: d.deployBlock },
    // Every launched token is a new contract: follow the factory's TokenCreated event to discover them,
    // so the indexer sees their Transfer events (holder balances) without listing addresses by hand.
    Token: {
      abi: tokenAbi,
      chain: "main",
      address: factory({
        address: d.factory,
        event: getAbiItem({ abi: tokenFactoryAbi, name: "TokenCreated" }),
        parameter: "token",
      }),
      startBlock: d.deployBlock,
    },
  },
});
