import { launchpadAbi, tokenAbi } from "@vezta/abi";
import { previewBuyLocal, previewSellLocal, type Curve } from "@vezta/shared";
import { custom, decodeFunctionData, encodeErrorResult, encodeFunctionResult, toHex, type Address, type Hex } from "viem";

const SUPPLY = 10n ** 27n;
const ADDR = "0x0000000000000000000000000000000000000001" as const;

/** A curve at the start of its life: 1B tokens, a 0.05 ETH graduation, nothing sold. */
export const freshCurve = (over: Partial<Curve> = {}): Curve => ({
  quoteToken: ADDR,
  creator: ADDR,
  pair: ADDR,
  virtualTokenReserves: (SUPPLY * 16n) / 15n,
  virtualQuoteReserves: 50_000_000_000_000_000n / 3n,
  initialVirtualQuoteReserves: 50_000_000_000_000_000n / 3n,
  realTokenReserves: SUPPLY,
  realQuoteReserves: 0n,
  tokenTotalSupply: SUPPLY,
  floor: SUPPLY / 5n,
  creatorFeeBps: 0n,
  complete: false,
  migrated: false,
  launchTime: 1_700_000_000n,
  antiSniperWindow: 0,
  ...over,
});

export interface FakeChainState {
  curve: Curve;
  feeBps: bigint;
  taxBps: bigint;
  blockTimestamp: bigint;
  /** The person's token balance and their allowance to the launchpad. */
  tokenBalance: bigint;
  allowance: bigint;
  ethBalance: bigint;
  createFee: bigint;
  /** Makes previewBuy disagree with the local replica, to exercise the reconciliation. */
  previewBuyOverride?: (amount: bigint) => readonly [bigint, bigint, bigint];
  /** Makes previewBuy revert with a contract error, as it does once the curve has completed. */
  previewBuyRevert?: "CurveCompleted";
}

/**
 * A chain that answers the calls the app makes, from a state a test can change between polls. It answers with the real
 * ABI, so the code under test decodes exactly what a node would send. Every call is recorded by name.
 */
export function fakeChain(initial: Partial<FakeChainState> = {}) {
  const state: FakeChainState = {
    curve: freshCurve(),
    feeBps: 100n,
    taxBps: 0n,
    blockTimestamp: 1_700_000_100n,
    tokenBalance: 0n,
    allowance: 0n,
    ethBalance: 10n ** 18n,
    createFee: 5_000_000_000_000_000n,
    ...initial,
  };
  const calls: string[] = [];

  function ethCall(to: Address, data: Hex): Hex {
    const isToken = to.toLowerCase() !== "0x00000000000000000000000000000000000000c3";
    if (isToken) {
      const { functionName } = decodeFunctionData({ abi: tokenAbi, data });
      calls.push(functionName);
      if (functionName === "allowance") return encodeFunctionResult({ abi: tokenAbi, functionName, result: state.allowance });
      if (functionName === "balanceOf") return encodeFunctionResult({ abi: tokenAbi, functionName, result: state.tokenBalance });
      throw new Error(`fakeChain: unhandled token call ${functionName}`);
    }
    const { functionName, args } = decodeFunctionData({ abi: launchpadAbi, data });
    calls.push(functionName);
    switch (functionName) {
      case "getCurve":
        return encodeFunctionResult({ abi: launchpadAbi, functionName, result: state.curve });
      case "tradeFeeBps":
        return encodeFunctionResult({ abi: launchpadAbi, functionName, result: state.feeBps });
      case "currentLaunchTaxBps":
        return encodeFunctionResult({ abi: launchpadAbi, functionName, result: state.taxBps });
      case "createFee":
        return encodeFunctionResult({ abi: launchpadAbi, functionName, result: state.createFee });
      case "previewBuy": {
        if (state.previewBuyRevert) {
          // A node reports a custom error as a JSON-RPC error carrying the encoded revert data.
          const err = new Error("execution reverted") as Error & { code: number; data: Hex };
          err.code = 3;
          err.data = encodeErrorResult({ abi: launchpadAbi, errorName: state.previewBuyRevert });
          throw err;
        }
        const amount = args![1] as bigint;
        const local = previewBuyLocal(state.curve, { feeBps: state.feeBps, taxBps: state.taxBps }, amount);
        const result = state.previewBuyOverride ? state.previewBuyOverride(amount) : ([local.amountOut, local.quoteCost, local.fee] as const);
        return encodeFunctionResult({ abi: launchpadAbi, functionName, result });
      }
      case "previewSell": {
        const local = previewSellLocal(state.curve, state.feeBps, args![1] as bigint);
        return encodeFunctionResult({ abi: launchpadAbi, functionName, result: [local.quoteOut, local.fee] });
      }
      default:
        throw new Error(`fakeChain: unhandled launchpad call ${functionName}`);
    }
  }

  // No retries: a failing fake should fail at once, not after viem's backoff.
  const transport = custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        const p = (params ?? []) as unknown[];
        switch (method) {
          case "eth_chainId":
            return toHex(11155111);
          case "eth_blockNumber":
            return toHex(100);
          case "eth_getBalance":
            return toHex(state.ethBalance);
          case "eth_gasPrice":
          case "eth_maxPriorityFeePerGas":
            return toHex(1_000_000_000n);
          case "eth_estimateGas":
            return toHex(150_000n);
          case "eth_getBlockByNumber":
            return {
              number: toHex(100),
              hash: `0x${"11".repeat(32)}`,
              parentHash: `0x${"00".repeat(32)}`,
              timestamp: toHex(state.blockTimestamp),
              baseFeePerGas: toHex(1_000_000_000n),
              gasLimit: toHex(30_000_000n),
              gasUsed: toHex(0n),
              transactions: [],
            };
          case "eth_call": {
            const { to, data } = p[0] as { to: Address; data: Hex };
            return ethCall(to, data);
          }
          default:
            throw new Error(`fakeChain: unhandled RPC ${method}`);
        }
      },
    },
    { retryCount: 0 },
  );

  return { state, calls, transport, set: (patch: Partial<FakeChainState>) => Object.assign(state, patch) };
}

export type FakeChain = ReturnType<typeof fakeChain>;
