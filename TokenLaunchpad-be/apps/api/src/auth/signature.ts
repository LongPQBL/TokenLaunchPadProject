import { createPublicClient, http, verifyMessage, type Address, type Hex } from "viem";

export type VerifySignature = (input: { address: Address; message: string; signature: Hex }) => Promise<boolean>;

/** A plain wallet's signature, checked locally with no network. Anything that throws is simply "not valid". */
export const verifyEoaSignature: VerifySignature = async (input) => {
  try {
    return await verifyMessage(input);
  } catch {
    return false;
  }
};

/**
 * Also accepts smart-contract wallets (ERC-1271 / ERC-6492), by asking the chain. Needs an RPC endpoint; without one
 * only plain wallets can sign in. A failure to reach the chain is "not valid", never "valid".
 */
export function verifyWithChain(rpcUrl: string): VerifySignature {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return async (input) => {
    try {
      return await client.verifyMessage(input);
    } catch {
      return false;
    }
  };
}
