/**
 * Creates a token on a local Anvil fork and prints its address, and does nothing else: nobody buys it.
 *
 * The state a token is in between its creation and its first trade is one no Trade event describes, so it is the one a handler that
 * only follows trades gets wrong (a price of 0). The creator is a random wallet funded from account 4, never an Anvil account.
 */
import { launchpadAbi, tokenFactoryAbi } from "@vezta/abi";
import { loadDeployment } from "@vezta/deployments";
import { createPublicClient, createWalletClient, http, parseEventLogs } from "viem";
import { mnemonicToAccount } from "viem/accounts";

const MNEMONIC = "test test test test test test test test test test test junk";
const d = loadDeployment();
const chain = { id: d.chainId, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL ?? "http://127.0.0.1:8545"] } } } as const;
const transport = http(chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
const funder = createWalletClient({ account: mnemonicToAccount(MNEMONIC, { addressIndex: 4 }), chain, transport });

const createFee = await pub.readContract({ address: d.launchpad, abi: launchpadAbi, functionName: "createFee" });
const hash = await funder.writeContract({
  address: d.factory,
  abi: tokenFactoryAbi,
  functionName: "deployERC20Token",
  args: ["Fresh", "FRESH", "ipfs://fresh-fixture", d.weth, 0],
  value: createFee,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
const [created] = parseEventLogs({ abi: tokenFactoryAbi, logs: receipt.logs, eventName: "TokenCreated" });
console.log(created!.args.token.toLowerCase());
