"use client";

import { useAccount } from "wagmi";

/**
 * Privy names the connector of the wallet it made for an email or Google login `io.privy.wallet.<the wallet's address>` (found by
 * logging in for real: the bare `io.privy.wallet` is only the family, not any connector's id).
 */
export const EMBEDDED_CONNECTOR_PREFIX = "io.privy.wallet.";
export const embeddedConnectorId = (address: string): string => `${EMBEDDED_CONNECTOR_PREFIX}${address}`;

/**
 * Is this connector Privy's embedded wallet FOR THIS ACCOUNT? A wallet announces its own id, so any extension could claim the
 * prefix; requiring the address in the id to be the connected account's makes a look-alike (another address, junk after the
 * prefix, a different case of the prefix) an ordinary external wallet. The address part is compared without regard to case.
 */
export function isEmbeddedConnector(connector: { id: string } | undefined, address: string | undefined): boolean {
  if (!connector || !address) return false;
  return connector.id.startsWith(EMBEDDED_CONNECTOR_PREFIX) && connector.id.slice(EMBEDDED_CONNECTOR_PREFIX.length).toLowerCase() === address.toLowerCase();
}

/**
 * Which kind of wallet is connected. An external wallet that logged in THROUGH Privy is still "external": only the wallet Privy
 * itself made counts as "embedded", because only that one signs without asking.
 */
export function useWalletKind(): "none" | "external" | "embedded" {
  const { address, connector } = useAccount();
  if (!address) return "none";
  return isEmbeddedConnector(connector, address) ? "embedded" : "external";
}
