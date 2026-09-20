"use client";

import { useMemo } from "react";
import { usePublicClient, useAccount, useWalletClient } from "wagmi";
import { getDeployment } from "../deployment";
import { createSelfCustody } from "./self-custody";
import { TradeError, type UseTrade } from "./types";

/** What a build with no deployment configured offers: every action says why it cannot happen. */
const notConfigured = (): never => {
  throw new TradeError("not_configured", "Trading is not configured for this deployment.");
};
const UNCONFIGURED: UseTrade = {
  capabilities: { kind: "self-custody", address: undefined, chainId: undefined, canBatch: false, isZeroPrompt: false },
  buyWithEth: async () => notConfigured(),
  sell: async () => notConfigured(),
  approveIfNeeded: async () => notConfigured(),
  createToken: async () => notConfigured(),
};

/**
 * The one way the panels trade. Today it is the person's own wallet; the session wallet and the embedded wallet
 * (later groups) slot in behind this same return type, so the panels never learn who signs.
 */
export function useTrade(): UseTrade {
  const deployment = getDeployment();
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: deployment?.chainId });

  return useMemo(() => {
    if (!deployment || !publicClient) return UNCONFIGURED;
    return createSelfCustody({
      deployment,
      expectedChainId: deployment.chainId,
      account: address,
      chainId,
      walletClient,
      publicClient,
    });
  }, [deployment?.launchpad, deployment?.factory, deployment?.chainId, address, chainId, walletClient, publicClient]);
}
