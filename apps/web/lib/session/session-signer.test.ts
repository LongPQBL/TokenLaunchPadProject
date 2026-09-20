import { launchpadAbi, tokenAbi } from "@vezta/abi";
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  decodeFunctionData,
  maxUint256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { createSessionTrade } from "./session-signer";

const LAUNCHPAD = "0x00000000000000000000000000000000000000c3" as Address;
const FACTORY = "0x00000000000000000000000000000000000000d4" as Address;
const WETH = "0x00000000000000000000000000000000000000e5" as Address;
const TOKEN = "0x00000000000000000000000000000000000000b2" as Address;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const deployment = { launchpad: LAUNCHPAD, factory: FACTORY, weth: WETH };

/**
 * A node that KNOWS NO ACCOUNTS: it can only take a signed raw transaction. If the session signer asked it to sign
 * (eth_sendTransaction, eth_accounts, personal_sign) this fake would throw, exactly as a real node would, and the trade
 * would fail. What it records is what really crossed the wire.
 */
function fakeNode(state: { allowance: bigint }) {
  const calls: string[] = [];
  const rawTransactions: Hex[] = [];
  const request = async ({ method, params }: { method: string; params?: unknown }) => {
    calls.push(method);
    const p = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return toHex(sepolia.id);
      case "eth_getTransactionCount":
        return "0x0";
      case "eth_estimateGas":
        return toHex(200_000n);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return toHex(1_000_000_000n);
      case "eth_getBlockByNumber":
        return { number: "0x64", hash: `0x${"11".repeat(32)}`, parentHash: `0x${"00".repeat(32)}`, timestamp: "0x1", baseFeePerGas: toHex(1_000_000_000n), gasLimit: toHex(30_000_000n), gasUsed: "0x0", transactions: [] };
      case "eth_call": {
        const { to, data } = p[0] as { to: Address; data: Hex };
        if (to.toLowerCase() === TOKEN.toLowerCase()) {
          const { functionName } = decodeFunctionData({ abi: tokenAbi, data });
          if (functionName === "allowance") return encodeFunctionResult({ abi: tokenAbi, functionName, result: state.allowance });
        }
        throw new Error(`unhandled eth_call`);
      }
      case "eth_sendRawTransaction":
        rawTransactions.push(p[0] as Hex);
        return HASH;
      case "eth_getTransactionReceipt": {
        const topics = encodeEventTopics({ abi: launchpadAbi, eventName: "Trade", args: { mint: TOKEN, user: "0x00000000000000000000000000000000000000a1" } });
        const data = encodeAbiParameters(
          [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
          [900n, 10n ** 18n, true, 1n, 1n, 1n, 9n, 0n],
        );
        return {
          status: "0x1", transactionHash: HASH, blockNumber: "0x65", blockHash: `0x${"22".repeat(32)}`, transactionIndex: "0x0", from: TOKEN, to: LAUNCHPAD,
          cumulativeGasUsed: "0x1", gasUsed: "0x1", effectiveGasPrice: "0x1", contractAddress: null, logsBloom: `0x${"00".repeat(256)}`, type: "0x2",
          logs: [{ address: LAUNCHPAD, topics, data, blockNumber: "0x65", transactionHash: HASH, transactionIndex: "0x0", blockHash: `0x${"22".repeat(32)}`, logIndex: "0x0", removed: false }],
        };
      }
      default:
        // eth_sendTransaction, eth_accounts, personal_sign, ...: a node holds no keys
        throw Object.assign(new Error(`the node cannot do ${method}`), { code: -32601 });
    }
  };
  return { calls, rawTransactions, request };
}

function setup(allowance = 0n) {
  const account = privateKeyToAccount(generatePrivateKey());
  const state = { allowance };
  const node = fakeNode(state);
  const publicClient = createPublicClient({ chain: sepolia, transport: custom({ request: node.request }, { retryCount: 0 }) });
  const trade = createSessionTrade({ account, deployment, publicClient });
  return { account, node, trade, state };
}

describe("createSessionTrade", () => {
  it("is the session signer: it names the wallet it trades from and needs no prompt", () => {
    const { account, trade } = setup();
    expect(trade.capabilities).toMatchObject({ kind: "session", address: account.address, chainId: sepolia.id, isZeroPrompt: true });
  });

  it("buys by signing the transaction ITSELF: the node gets a raw signed transaction from the session address and is never asked to sign", async () => {
    const { account, node, trade } = setup();
    const result = await trade.buyWithEth({ token: TOKEN, amount: 10n ** 18n, maxQuoteCost: 10n ** 16n });

    expect(node.rawTransactions).toHaveLength(1);
    const raw = node.rawTransactions[0]!;
    expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(account.address);
    const tx = parseTransaction(raw);
    expect(tx.to?.toLowerCase()).toBe(LAUNCHPAD.toLowerCase());
    expect(tx.value).toBe(10n ** 16n); // value = maxQuoteCost: the contract refunds the difference
    expect(decodeFunctionData({ abi: launchpadAbi, data: tx.data! }).functionName).toBe("buyWithEth");

    for (const forbidden of ["eth_sendTransaction", "eth_accounts", "eth_requestAccounts", "personal_sign", "eth_sign"]) {
      expect(node.calls, forbidden).not.toContain(forbidden);
    }
    // and the result is what the Trade event said
    expect(result).toEqual({ hash: HASH, tokenAmount: 10n ** 18n, quoteAmount: 900n, fee: 9n, launchTax: 0n });
  });

  it("sells, approving first, entirely with the session key: two raw transactions, both from the session address", async () => {
    const { account, node, trade } = setup(0n);
    await trade.approveIfNeeded({ token: TOKEN, amount: 5n * 10n ** 18n });
    await trade.sell({ token: TOKEN, amount: 5n * 10n ** 18n, minQuoteOutput: 1n });

    expect(node.rawTransactions).toHaveLength(2);
    for (const raw of node.rawTransactions) expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(account.address);
    const approve = decodeFunctionData({ abi: tokenAbi, data: parseTransaction(node.rawTransactions[0]!).data! });
    expect(approve.functionName).toBe("approve");
    expect((approve.args![0] as string).toLowerCase()).toBe(LAUNCHPAD); // (decoded addresses come back checksummed)
    expect(approve.args![1]).toBe(maxUint256);
    expect(node.calls).not.toContain("eth_sendTransaction");
  });

  it("skips the approval when the session wallet's allowance already covers the sale", async () => {
    const { node, trade } = setup(10n ** 30n);
    await trade.approveIfNeeded({ token: TOKEN, amount: 5n * 10n ** 18n });
    expect(node.rawTransactions).toHaveLength(0);
  });

  it("cannot batch: a local key has no wallet to ask, and does not need to", () => {
    expect(setup().trade.capabilities.canBatch).toBe(false);
  });
});
