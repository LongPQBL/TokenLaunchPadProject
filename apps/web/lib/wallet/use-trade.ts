"use client";

import { useMemo } from "react";
import { useAccount, useCapabilities, usePublicClient, useWalletClient } from "wagmi";
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
  // EIP-5792: does the wallet say it can run approve + sell as one atomic batch? A wallet that does not know the
  // method errors, and an error is simply "no": the two-step path always works.
  const capabilities = useCapabilities({ account: address, query: { enabled: !!address && !!deployment, retry: false } });
  const atomic = deployment ? capabilities.data?.[deployment.chainId]?.atomic?.status : undefined;
  const canBatch = atomic === "supported" || atomic === "ready";

  return useMemo(() => {
    if (!deployment || !publicClient) return UNCONFIGURED;
    return createSelfCustody({
      deployment,
      expectedChainId: deployment.chainId,
      account: address,
      chainId,
      walletClient,
      publicClient,
      canBatch,
    });
  }, [deployment?.launchpad, deployment?.factory, deployment?.chainId, address, chainId, walletClient, publicClient, canBatch]);
}
