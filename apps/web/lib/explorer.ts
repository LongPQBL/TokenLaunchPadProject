import type { ChainConfig } from "@vezta/shared";
import { isAddress } from "./format";

/**
 * The block-explorer page for an address, or undefined. The value is about to become an href, so anything that is not
 * a 20-byte hex address gets no link at all: one function decides that, for every place a link is written.
 */
export function explorerAddressUrl(chain: ChainConfig | undefined, address: string): string | undefined {
  return chain && isAddress(address) ? `${chain.explorerUrl}/address/${address}` : undefined;
}
