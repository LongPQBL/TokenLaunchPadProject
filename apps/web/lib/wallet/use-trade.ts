"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useCapabilities, usePublicClient, useWalletClient } from "wagmi";
import { getDeployment } from "../deployment";
import { rememberToken } from "../session/holdings";
import { createSessionTrade } from "../session/session-signer";
import { useSession } from "../session/use-session";
import { createEmbeddedWalletClient } from "./embedded-signer";
import { createSelfCustody } from "./self-custody";
import { TradeError, type UseTrade } from "./types";
import { isEmbeddedConnector } from "./wallet-kind";

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
/** The embedded wallet is connected but its signer is still opening: nothing can be sent yet, and nothing falls back to another wallet. */
const embeddedOpening = (address: `0x${string}` | undefined, chainId: number | undefined): UseTrade => {
  const opening = async (): Promise<never> => {
    throw new TradeError("not_connected", "Your wallet is still opening. Try again in a moment.");
  };
  return {
    capabilities: { kind: "embedded", address, chainId, canBatch: false, isZeroPrompt: true },
    buyWithEth: opening,
    sell: opening,
    approveIfNeeded: opening,
    createToken: opening,
  };
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
  const { address, chainId, connector } = useAccount();
  const session = useSession();
  const embedded = isEmbeddedConnector(connector);
  // The embedded wallet's signer, asked for once per connection. Undefined while it opens.
  const [provider, setProvider] = useState<{ request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }>();
  useEffect(() => {
    setProvider(undefined);
    // Right after a page load wagmi restores the connector from storage as a bare record, with no methods, until it reconnects:
    // until then the signer is simply "still opening".
    if (!embedded || typeof connector?.getProvider !== "function") return;
    let live = true;
    void connector
      .getProvider()
      .then((p) => live && setProvider(p as never))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [embedded, connector, address]);
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: deployment?.chainId });
  // EIP-5792: does the wallet say it can run approve + sell as one atomic batch? A wallet that does not know the
  // method errors, and an error is simply "no": the two-step path always works.
  const capabilities = useCapabilities({ account: address, query: { enabled: !!address && !!deployment, retry: false } });
  const atomic = deployment ? capabilities.data?.[deployment.chainId]?.atomic?.status : undefined;
  const canBatch = atomic === "supported" || atomic === "ready";

  return useMemo(() => {
    if (!deployment || !publicClient) return UNCONFIGURED;
    // An embedded wallet IS the trading wallet (spec 7.3): it signs by itself, so there is no session wallet on top of it, and
    // whatever the session provider says is not looked at.
    if (embedded) {
      if (!provider) return embeddedOpening(address, chainId);
      return createSelfCustody({
        deployment,
        expectedChainId: deployment.chainId,
        account: address,
        chainId,
        walletClient: createEmbeddedWalletClient({
          provider,
          publicClient,
          account: address,
          chainId,
          expectedChainId: deployment.chainId,
        }) as never,
        kind: "embedded",
        canBatch: false,
        publicClient,
      });
    }
    // Trading from the session wallet needs no prompt. If it is turned on but not usable, the trade is REFUSED: quietly
    // falling back to the main wallet would spend from an account the person did not choose for this.
    if (session.status === "ready" && session.account) {
      return createSessionTrade({
        account: session.account,
        deployment,
        publicClient,
        onTokenHeld: (token) => address && rememberToken(address, token),
      });
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
  }, [
    deployment?.launchpad,
    deployment?.factory,
    deployment?.chainId,
    address,
    chainId,
    walletClient,
    publicClient,
    canBatch,
    session.status,
    session.account,
    embedded,
    provider,
  ]);
}
