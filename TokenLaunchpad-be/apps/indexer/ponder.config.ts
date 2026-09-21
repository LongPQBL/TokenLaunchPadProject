import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "@vezta/abi";
import { loadDeployment } from "@vezta/deployments";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

const d = loadDeployment();

export default createConfig({
  chains: {
    main: {
      id: d.chainId,
      // Two URLs on a real network: the first sync reads a lot of logs and a single public
      // endpoint will rate-limit it into failure (spec §12).
      rpc: [process.env[`PONDER_RPC_URL_${d.chainId}`] ?? "http://127.0.0.1:8545"].concat(
        process.env[`PONDER_RPC_URL_${d.chainId}_FALLBACK`] ?? [],
      ),
    },
  },
  contracts: {
    Launchpad: { abi: launchpadAbi, chain: "main", address: d.launchpad, startBlock: d.deployBlock },
    Factory: { abi: tokenFactoryAbi, chain: "main", address: d.factory, startBlock: d.deployBlock },
    // Every launched token is a new contract. Follow the factory's TokenCreated event so their
    // Transfer events are indexed too, including tokens created after the indexer started.
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
