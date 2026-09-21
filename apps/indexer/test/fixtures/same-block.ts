/**
 * Puts several buys into ONE block on a local Anvil fork and prints the token's address.
 *
 * When every trade lands in its own block, ordering bugs cannot show. This forces the case they
 * break on: automine off, three buys queued, one block mined. Random wallets do the buying (never
 * an Anvil account: bots sweep the well-known keys and a fork inherits that), funded from account 4.
 */
import { launchpadAbi, tokenFactoryAbi } from "@vezta/abi";
import { loadDeployment } from "@vezta/deployments";
import { createPublicClient, createTestClient, createWalletClient, http, parseEventLogs } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

const MNEMONIC = "test test test test test test test test test test test junk";
const d = loadDeployment();
const chain = { id: d.chainId, name: "local", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL ?? "http://127.0.0.1:8545"] } } } as const;
const transport = http(chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: "anvil" });
const funder = createWalletClient({ account: mnemonicToAccount(MNEMONIC, { addressIndex: 4 }), chain, transport });

// No anti-sniper window, so the price depends only on trade order and not on time.
const createFee = await pub.readContract({ address: d.launchpad, abi: launchpadAbi, functionName: "createFee" });
const createHash = await funder.writeContract({
  address: d.factory,
  abi: tokenFactoryAbi,
  functionName: "deployERC20Token",
  args: ["SameBlock", "SAME", "ipfs://same-block-fixture", d.weth, 0],
  value: createFee,
});
const createReceipt = await pub.waitForTransactionReceipt({ hash: createHash });
const [created] = parseEventLogs({ abi: tokenFactoryAbi, logs: createReceipt.logs, eventName: "TokenCreated" });
const token = created!.args.token;

const buyers = [0, 1, 2].map(() => createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain, transport }));
for (const b of buyers) {
  const h = await funder.sendTransaction({ to: b.account.address, value: 10n ** 18n });
  await pub.waitForTransactionReceipt({ hash: h });
}

// Different sizes so each buy moves the price to a clearly different level.
const amounts = [5_000_000n, 50_000_000n, 200_000_000n].map((n) => n * 10n ** 18n);
const maxCosts = await Promise.all(
  amounts.map(async (amount) => {
    const [, quoteCost, fee] = await pub.readContract({ address: d.launchpad, abi: launchpadAbi, functionName: "previewBuy", args: [token, amount] });
    return ((quoteCost + fee) * 300n) / 100n; // headroom: later buys in the block cost more
  }),
);

await test.setAutomine(false);
const hashes: `0x${string}`[] = [];
for (let i = 0; i < buyers.length; i++) {
  hashes.push(
    await buyers[i]!.writeContract({ address: d.launchpad, abi: launchpadAbi, functionName: "buyWithEth", args: [token, amounts[i]!, maxCosts[i]!], value: maxCosts[i]! }),
  );
}
await test.mine({ blocks: 1 });
await test.setAutomine(true);

const receipts = await Promise.all(hashes.map((hash) => pub.waitForTransactionReceipt({ hash })));
const blocks = new Set(receipts.map((r) => r.blockNumber));
if (blocks.size !== 1) throw new Error(`the buys landed in ${blocks.size} blocks; the fixture is invalid`);

console.log(token.toLowerCase());
