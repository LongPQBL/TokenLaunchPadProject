"use client";

import { useQuery } from "@tanstack/react-query";
import { launchpadAbi, tokenFactoryAbi } from "@vezta/abi";
import { useAccount, useGasPrice, usePublicClient, useReadContract } from "wagmi";
import { getDeployment } from "../deployment";
import type { AntiSniperWindow } from "../wallet/types";

/** A URI as long as a real one, so the gas estimate does not undershoot on the calldata. */
const PLACEHOLDER_URI = `ipfs://${"a".repeat(59)}`;

/**
 * What creating a token will cost, before the wallet opens: the creation fee (read from the chain) and the network fee
 * (an estimate: the real creation call with a placeholder URI, times the current gas price). The network fee needs a
 * connected wallet and a filled-in form; without them it is simply absent. It is never guessed.
 */
export function useCreateEstimate({ name, ticker, antiSniperWindow }: { name: string; ticker: string; antiSniperWindow: AntiSniperWindow }) {
  const deployment = getDeployment();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: deployment?.chainId });

  const fee = useReadContract({
    address: deployment?.launchpad,
    abi: launchpadAbi,
    functionName: "createFee",
    chainId: deployment?.chainId,
    query: { enabled: !!deployment },
  });
  const gasPrice = useGasPrice({ chainId: deployment?.chainId });

  const ready = !!deployment && !!publicClient && !!address && name.trim() !== "" && ticker.trim() !== "" && fee.data !== undefined;
  const gas = useQuery({
    queryKey: ["create-gas", address, name, ticker, antiSniperWindow, fee.data?.toString()],
    enabled: ready,
    retry: false,
    queryFn: () =>
      publicClient!.estimateContractGas({
        address: deployment!.factory,
        abi: tokenFactoryAbi,
        functionName: "deployERC20Token",
        args: [name.trim(), ticker.trim(), PLACEHOLDER_URI, deployment!.weth, antiSniperWindow],
        value: fee.data,
        account: address,
      }),
  });

  return {
    createFee: fee.data,
    networkFee: gas.data !== undefined && gasPrice.data !== undefined ? gas.data * gasPrice.data : undefined,
  };
}
