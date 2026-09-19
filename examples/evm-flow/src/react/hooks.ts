// Reference wagmi hooks for the frontend. They are only type-checked here (no browser), but they use the same
// contract calls that src/run-all.ts executes against a real deployment.
import type { Address } from "viem";
import { maxUint256 } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { launchpadAbi, tokenAbi, tokenFactoryAbi } from "../../../../abi/index.ts";
import { maxCostWithSlippage, minPayoutWithSlippage } from "../lib.ts";

interface Deployment {
  launchpad: Address;
  factory: Address;
}

/** Live price of `amount` tokens. Refreshes every 3 s because the launch tax changes with time. */
export function useBuyQuote(d: Deployment, token: Address | undefined, amount: bigint | undefined) {
  const enabled = !!token && !!amount && amount > 0n;
  const preview = useReadContract({
    address: d.launchpad,
    abi: launchpadAbi,
    functionName: "previewBuy",
    args: token && amount ? [token, amount] : undefined,
    query: { enabled, refetchInterval: 3_000 },
  });
  const tax = useReadContract({
    address: d.launchpad,
    abi: launchpadAbi,
    functionName: "currentLaunchTaxBps",
    args: token ? [token] : undefined,
    query: { enabled: !!token, refetchInterval: 3_000 },
  });
  const [amountOut, quoteCost, fee] = preview.data ?? [];
  return {
    amountOut, // may be smaller than `amount`: the last buy is clipped
    quoteCost,
    fee,
    total: quoteCost !== undefined && fee !== undefined ? quoteCost + fee : undefined,
    taxBps: tax.data,
    isLoading: preview.isLoading,
  };
}

/** Buy with native ETH. Call `buy(amount, total)` with the quote from useBuyQuote. */
export function useBuyWithEth(d: Deployment) {
  const { writeContractAsync, data: hash, isPending, error } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  return {
    buy: (token: Address, amount: bigint, quotedTotal: bigint, slippageBps = 100n) => {
      const maxCost = maxCostWithSlippage(quotedTotal, slippageBps);
      return writeContractAsync({
        address: d.launchpad,
        abi: launchpadAbi,
        functionName: "buyWithEth",
        args: [token, amount, maxCost],
        value: maxCost, // the contract refunds what exceeds the real price
      });
    },
    buyAll: (token: Address, quotedTotal: bigint, slippageBps = 100n) => {
      const maxCost = maxCostWithSlippage(quotedTotal, slippageBps);
      return writeContractAsync({
        address: d.launchpad, abi: launchpadAbi, functionName: "buyWithEth", args: [token, maxUint256, maxCost], value: maxCost,
      });
    },
    hash, isPending, error, isConfirmed: receipt.isSuccess,
  };
}

/** Sell for native ETH: approve first (skip when allowance is already enough), then sell. */
export function useSellForEth(d: Deployment, token: Address | undefined) {
  const { address: owner } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const allowance = useReadContract({
    address: token,
    abi: tokenAbi,
    functionName: "allowance",
    args: owner && token ? [owner, d.launchpad] : undefined,
    query: { enabled: !!owner && !!token },
  });
  return {
    allowance: allowance.data,
    approve: (amount: bigint) =>
      writeContractAsync({ address: token!, abi: tokenAbi, functionName: "approve", args: [d.launchpad, amount] }),
    sell: (amount: bigint, quotedPayout: bigint, slippageBps = 100n) =>
      writeContractAsync({
        address: d.launchpad,
        abi: launchpadAbi,
        functionName: "sellForEth",
        args: [token!, amount, minPayoutWithSlippage(quotedPayout, slippageBps)],
      }),
  };
}

/** Creates a token. `createFee` comes from useReadContract({ functionName: "createFee" }) on the launchpad. */
export function useCreateToken(d: Deployment) {
  const { writeContractAsync, data: hash, isPending } = useWriteContract();
  return {
    create: (p: { name: string; ticker: string; metadataURI: string; quoteToken: Address; window: 0 | 60 | 600 | 5880; createFee: bigint }) =>
      writeContractAsync({
        address: d.factory,
        abi: tokenFactoryAbi,
        functionName: "deployERC20Token",
        args: [p.name, p.ticker, p.metadataURI, p.quoteToken, p.window],
        value: p.createFee,
      }),
    hash, isPending,
  };
}
