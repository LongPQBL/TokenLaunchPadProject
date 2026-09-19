import type { Address, PublicClient } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";

// Sign-In With Ethereum (EIP-4361): the user proves they own a wallet by signing a message. The backend stores
// nothing secret; it only remembers the nonce until it is used. Works for smart-contract wallets too.

/** Step 1 (backend): issue a challenge. Store `nonce` (e.g. in Redis, 10 minutes) and send `message` to the client. */
export function newChallenge(p: { address: Address; chainId: number; domain: string; uri: string }) {
  const nonce = generateSiweNonce();
  const message = createSiweMessage({
    address: p.address,
    chainId: p.chainId,
    domain: p.domain, // must equal the website's host: this is what defeats phishing sites
    uri: p.uri,
    nonce,
    version: "1",
    statement: "Sign in to the Vezta Launchpad. This does not cost gas.",
    expirationTime: new Date(Date.now() + 10 * 60_000),
  });
  return { nonce, message };
}

/**
 * Step 3 (backend): check the signature. `nonce` is the one you stored for this address; delete it afterwards so a
 * signature can never be replayed. Returns the verified address, or null.
 */
export async function verifyLogin(
  publicClient: PublicClient,
  p: { message: string; signature: `0x${string}`; domain: string; nonce: string },
): Promise<Address | null> {
  const ok = await publicClient.verifySiweMessage({ message: p.message, signature: p.signature, domain: p.domain, nonce: p.nonce });
  return ok ? (parseSiweMessage(p.message).address as Address) : null;
}
