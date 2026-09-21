import type { Address } from "viem";
import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/) as unknown as z.ZodType<Address>;
const schema = z.object({ chainId: z.number().int().positive(), launchpad: address, factory: address, weth: address });

/** The few addresses the browser needs. The rest of the deployment file (owner, deployer, ...) never ships to it. */
export type WebDeployment = z.infer<typeof schema>;

/**
 * NEXT_PUBLIC_DEPLOYMENT is written into the build by next.config.ts from packages/deployments/<name>.json, the same
 * file the indexer and the API read, so there is still exactly one place an address comes from. Undefined means the
 * build had no deployment (trading then says it is not configured); a malformed one throws, because a wrong address
 * in here would send a person's ETH to the wrong contract.
 */
export function parseDeployment(raw: string | undefined): WebDeployment | undefined {
  if (!raw) return undefined;
  try {
    return schema.parse(JSON.parse(raw));
  } catch (e) {
    throw new Error(`NEXT_PUBLIC_DEPLOYMENT is not a valid deployment: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Next only inlines `process.env.NEXT_PUBLIC_X` when it is written out in full, hence no destructuring here. */
export const getDeployment = () => parseDeployment(process.env.NEXT_PUBLIC_DEPLOYMENT);
