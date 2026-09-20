"use client";

import { useMemo } from "react";
import { useAccount, useCapabilities, usePublicClient, useWalletClient } from "wagmi";
import { getDeployment } from "../deployment";
import { rememberToken } from "../session/holdings";
import { createSessionTrade } from "../session/session-signer";
import { useSession } from "../session/use-session";
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

/** The session wallet is on but cannot be used yet (still opening, lost from this browser, or mismatched): nothing is sent from anywhere. */
const NO_SESSION: UseTrade = {
  capabilities: { kind: "session", address: undefined, chainId: undefined, canBatch: false, isZeroPrompt: true },
  buyWithEth: async () => noSession(),
  sell: async () => noSession(),
  approveIfNeeded: async () => noSession(),
  createToken: async () => noSession(),
};
const noSession = (): never => {
  throw new TradeError("no_session", "Turn on your trading wallet first.");
};

/**
 * The one way the panels trade. Today it is the person's own wallet; the session wallet and the embedded wallet
 * (later groups) slot in behind this same return type, so the panels never learn who signs.
 */
export function useTrade(): UseTrade {
  const deployment = getDeployment();
  const { address, chainId } = useAccount();
  const session = useSession();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: deployment?.chainId });
  // EIP-5792: does the wallet say it can run approve + sell as one atomic batch? A wallet that does not know the
  // method errors, and an error is simply "no": the two-step path always works.
  const capabilities = useCapabilities({ account: address, query: { enabled: !!address && !!deployment, retry: false } });
  const atomic = deployment ? capabilities.data?.[deployment.chainId]?.atomic?.status : undefined;
  const canBatch = atomic === "supported" || atomic === "ready";

  return useMemo(() => {
    if (!deployment || !publicClient) return UNCONFIGURED;
    // Trading from the session wallet needs no prompt. If it is turned on but not usable, the trade is REFUSED: quietly
    // falling back to the main wallet would spend from an account the person did not choose for this.
    if (session.status === "ready" && session.account) {
      return createSessionTrade({ account: session.account, deployment, publicClient, onTokenHeld: (token) => address && rememberToken(address, token) });
    }
    if (session.status !== "off") return NO_SESSION;
    return createSelfCustody({
      deployment,
      expectedChainId: deployment.chainId,
      account: address,
      chainId,
      walletClient,
      publicClient,
      canBatch,
    });
  }, [deployment?.launchpad, deployment?.factory, deployment?.chainId, address, chainId, walletClient, publicClient, canBatch, session.status, session.account]);
}
