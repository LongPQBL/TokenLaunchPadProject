import type { Address, Hash } from "viem";
import { callLaunchpad, type LaunchpadCallDeps } from "../wallet/launchpad-call";

export interface ClaimDeps extends LaunchpadCallDeps {
  /** The quote token the fees accrue in (WETH on an ETH launchpad). */
  quote: Address;
}

/**
 * Claims a creator's accrued fees. The contract's `claimCreatorFees` is permissionless and always pays the creator, whoever
 * sends it; the page offers it only to the creator, because showing it to anyone else would imply they receive the money.
 */
export const claimCreatorFees = (deps: ClaimDeps, creator: Address): Promise<{ hash: Hash }> =>
  callLaunchpad(deps, "claimCreatorFees", [creator, deps.quote]);
