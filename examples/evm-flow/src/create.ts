import { parseEventLogs, type Address } from "viem";
import { launchpadAbi, tokenFactoryAbi } from "../../../abi/index.ts";
import type { Ctx, Wallet } from "./clients.ts";

export interface CreateParams {
  name: string;
  ticker: string;
  metadataURI: string; // ipfs://... produced by the backend's metadata upload
  quoteToken: Address; // must be whitelisted; WETH on the default deployment
  antiSniperWindow: 0 | 60 | 600 | 5880; // seconds of launch tax on buys
}

/** Creates a token and returns its address, read from the TokenCreated event. */
export async function createToken(ctx: Ctx, creator: Wallet, p: CreateParams) {
  const { deployment, publicClient } = ctx;
  // The create fee is paid in native ETH on top of gas. Excess is refunded by the contract.
  const createFee = await publicClient.readContract({
    address: deployment.launchpad,
    abi: launchpadAbi,
    functionName: "createFee",
  });
  const hash = await creator.writeContract({
    address: deployment.factory,
    abi: tokenFactoryAbi,
    functionName: "deployERC20Token",
    args: [p.name, p.ticker, p.metadataURI, p.quoteToken, p.antiSniperWindow],
    value: createFee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const [created] = parseEventLogs({ abi: tokenFactoryAbi, logs: receipt.logs, eventName: "TokenCreated" });
  return { token: created!.args.token, createFee, hash, gasUsed: receipt.gasUsed };
}
