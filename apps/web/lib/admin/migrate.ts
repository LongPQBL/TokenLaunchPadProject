import type { Address, Hash } from "viem";
import { callLaunchpad, type LaunchpadCallDeps } from "../wallet/launchpad-call";

export type MigrateDeps = LaunchpadCallDeps;

/**
 * Finishes a curve that has filled, from the admin's own wallet. `migrate` is permissionless (the bot only makes it happen
 * sooner), so nothing about this needs the API or a special key: the person pays the gas, and if the bot or anyone else got
 * there first the transaction reverts and they are told so.
 */
export const migrateToken = (deps: MigrateDeps, token: Address): Promise<{ hash: Hash }> => callLaunchpad(deps, "migrate", [token]);
