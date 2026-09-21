"use client";

import { useAccount } from "wagmi";

/** The connector id of the wallet Privy creates for an email or Google login. */
export const EMBEDDED_CONNECTOR_ID = "io.privy.wallet";

/** Exact match only: any other id, however alike, is an external wallet and gets none of the embedded wallet's treatment. */
export const isEmbeddedConnector = (connector: { id: string } | undefined): boolean => connector?.id === EMBEDDED_CONNECTOR_ID;

/**
 * Which kind of wallet is connected. An external wallet that logged in THROUGH Privy is still "external": only the wallet Privy
 * itself made counts as "embedded", because only that one signs without asking.
 */
export function useWalletKind(): "none" | "external" | "embedded" {
  const { address, connector } = useAccount();
  if (!address) return "none";
  return isEmbeddedConnector(connector) ? "embedded" : "external";
}
