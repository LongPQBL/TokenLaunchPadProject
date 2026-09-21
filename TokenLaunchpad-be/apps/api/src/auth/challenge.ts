import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from "viem/siwe";

export const NONCE_TTL_SECONDS = 10 * 60;

export interface ChallengeInput {
  address: Address;
  chainId: number;
  /** Must equal the website's host: this is what stops a phishing site reusing a signature. */
  domain: string;
  uri: string;
  now?: Date;
}

/** A fresh sign-in message. The nonce is 128 random bits; the message expires with it. */
export function createChallenge({ address, chainId, domain, uri, now = new Date() }: ChallengeInput) {
  const nonce = randomBytes(16).toString("hex");
  const message = createSiweMessage({
    address,
    chainId,
    domain,
    uri,
    nonce,
    version: "1",
    statement: "Sign in to the Vezta Launchpad. This does not cost gas.",
    issuedAt: now,
    expirationTime: new Date(now.getTime() + NONCE_TTL_SECONDS * 1000),
  });
  return { nonce, message };
}

/**
 * Whether a message is one of OURS, before any signature is looked at: our domain, our chain, not expired. Returns
 * the fields the rest of sign-in needs, or undefined. One undefined for every reason: what failed is not for the
 * caller to learn.
 */
export function readMessage(message: string, expected: { domain: string; chainId: number; now?: Date }) {
  const parsed = parseSiweMessage(message);
  if (!parsed.address || !parsed.nonce || parsed.chainId !== expected.chainId) return undefined;
  if (!validateSiweMessage({ message: parsed, domain: expected.domain, time: expected.now ?? new Date() })) return undefined;
  return { address: parsed.address, nonce: parsed.nonce };
}
