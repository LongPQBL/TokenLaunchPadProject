import { tokenAbi } from "@vezta/abi";
import { decodeFunctionData, encodeFunctionResult, parseTransaction, recoverTransactionAddress, toHex, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

const lower = (a: string) => a.toLowerCase();

/**
 * A node with a MEMORY: it keeps ETH and token balances, takes only signed raw transactions, checks nonces and that the
 * sender can pay for gas AND value up front (as a real node does), and applies each transfer. So a test can ask "what
 * does this wallet hold now?" and get an answer that depends on the ORDER things were sent in.
 */
export function ledgerNode(initial: {
  eth?: Record<string, bigint>;
  tokens?: Record<string, Record<string, bigint>>;
  /** Tokens whose transfers revert (the estimate fails, so nothing is sent and nothing is charged). */
  failing?: string[];
}) {
  const eth = new Map(Object.entries(initial.eth ?? {}).map(([a, v]) => [lower(a), v]));
  const tokens = new Map(Object.entries(initial.tokens ?? {}).map(([t, h]) => [lower(t), new Map(Object.entries(h).map(([a, v]) => [lower(a), v]))]));
  const failing = new Set((initial.failing ?? []).map(lower));
  const nonces = new Map<string, number>();
  const sent: { kind: "eth" | "token"; to: string; token?: string; amount: bigint; from: string }[] = [];
  const calls: string[] = [];

  const ethOf = (a: string) => eth.get(lower(a)) ?? 0n;
  const tokenOf = (t: string, a: string) => tokens.get(lower(t))?.get(lower(a)) ?? 0n;

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    calls.push(method);
    const p = (params ?? []) as unknown[];
    switch (method) {
      case "eth_chainId":
        return toHex(sepolia.id);
      case "eth_blockNumber":
        return "0x64";
      case "eth_getBalance":
        return toHex(ethOf(String(p[0])));
      case "eth_getTransactionCount":
        return toHex(nonces.get(lower(String(p[0]))) ?? 0);
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return toHex(1_000_000_000n);
      case "eth_getBlockByNumber":
        return { number: "0x64", hash: `0x${"11".repeat(32)}`, parentHash: `0x${"00".repeat(32)}`, timestamp: "0x1", baseFeePerGas: toHex(1_000_000_000n), gasLimit: toHex(30_000_000n), gasUsed: "0x0", transactions: [] };
      case "eth_estimateGas": {
        const { to, data } = p[0] as { to: Address; data?: Hex };
        if (data && data !== "0x") {
          if (failing.has(lower(to))) throw Object.assign(new Error("execution reverted"), { code: 3 });
          return toHex(50_000n);
        }
        return toHex(21_000n);
      }
      case "eth_call": {
        const { to, data } = p[0] as { to: Address; data: Hex };
        const call = decodeFunctionData({ abi: tokenAbi, data });
        if (call.functionName === "balanceOf") return encodeFunctionResult({ abi: tokenAbi, functionName: "balanceOf", result: tokenOf(to, call.args![0] as string) });
        throw new Error(`ledgerNode: unhandled call ${call.functionName}`);
      }
      case "eth_sendRawTransaction": {
        const raw = p[0] as Hex;
        const tx = parseTransaction(raw);
        const from = lower(await recoverTransactionAddress({ serializedTransaction: raw as never }));
        if ((tx.nonce ?? 0) !== (nonces.get(from) ?? 0)) throw Object.assign(new Error("nonce too low"), { code: -32000 });
        const gasCost = (tx.gas ?? 0n) * (tx.maxFeePerGas ?? 0n);
        const value = tx.value ?? 0n;
        if (ethOf(from) < gasCost + value) throw Object.assign(new Error("insufficient funds for gas * price + value"), { code: -32000 });
        eth.set(from, ethOf(from) - gasCost - value);
        nonces.set(from, (nonces.get(from) ?? 0) + 1);
        const to = lower(tx.to!);
        if (tx.data && tx.data !== "0x") {
          const call = decodeFunctionData({ abi: tokenAbi, data: tx.data });
          if (call.functionName === "transfer") {
            const [dest, amount] = call.args as [Address, bigint];
            const book = tokens.get(to) ?? new Map<string, bigint>();
            tokens.set(to, book);
            book.set(from, (book.get(from) ?? 0n) - amount);
            book.set(lower(dest), (book.get(lower(dest)) ?? 0n) + amount);
            sent.push({ kind: "token", token: to, to: lower(dest), amount, from });
          }
        } else {
          eth.set(to, ethOf(to) + value);
          sent.push({ kind: "eth", to, amount: value, from });
        }
        return `0x${(sent.length).toString(16).padStart(64, "0")}`;
      }
      case "eth_getTransactionReceipt":
        return {
          status: "0x1", transactionHash: p[0], blockNumber: "0x65", blockHash: `0x${"22".repeat(32)}`, transactionIndex: "0x0",
          from: `0x${"00".repeat(20)}`, to: `0x${"00".repeat(20)}`, cumulativeGasUsed: "0x5208", gasUsed: "0x5208",
          effectiveGasPrice: "0x3b9aca00", contractAddress: null, logsBloom: `0x${"00".repeat(256)}`, type: "0x2", logs: [],
        };
      default:
        throw Object.assign(new Error(`the node cannot do ${method}`), { code: -32601 });
    }
  }

  return { request, calls, sent, ethOf, tokenOf };
}
