import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkName, clearKey, loadKey, saveKey } from "./storage";
import type { SessionAccount, SignWithMainWallet } from "./types";

/**
 * Fixed and versioned, and it names no domain. If it named the site, moving the site would change the signature, and with
 * it the wallet, and whatever the old wallet held would be stranded. Changing this string has the same effect: never do.
 */
export const SESSION_MESSAGE = "Vezta Launchpad — trading session v1";

/** The wallet signed differently than it did the first time. Never a reason to quietly make a second wallet. */
export class SessionMismatchError extends Error {
  constructor() {
    super("This wallet signed differently than before, so it cannot recover its trading wallet.");
    this.name = "SessionMismatchError";
  }
}

/**
 * The session key is keccak256 of the main wallet's signature over a fixed message. Deriving it, rather than
 * generating it, is what lets a person recover the wallet on a new machine by signing again: nothing has to be written
 * down. The signature is therefore equivalent to the private key. It is never persisted, logged or sent anywhere; it
 * exists in memory for the length of this call. (Its content is not in the error either.)
 */
function sessionKey(signature: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("malformed signature");
  return keccak256(signature);
}

export function deriveSessionAccount(signature: Hex): SessionAccount {
  return privateKeyToAccount(sessionKey(signature));
}

const inFlight = new Map<string, Promise<SessionAccount>>();

/**
 * The person's session wallet: from storage when it is there (no signature, no prompt), otherwise by having the main
 * wallet sign the fixed message once. The address is kept as a check value, so a wallet that stops signing the same
 * way is caught (SessionMismatchError) instead of being given a second, empty wallet. Two callers at once share one
 * signature request.
 */
export function loadOrCreateSession(mainAddress: string, sign: SignWithMainWallet): Promise<SessionAccount> {
  const main = mainAddress.toLowerCase();
  const running = inFlight.get(main);
  if (running) return running;

  const work = (async () => {
    const check = localStorage.getItem(checkName(main))?.toLowerCase();

    const restored = await restoreSession(main);
    if (restored) return restored;

    const key = sessionKey(await sign(SESSION_MESSAGE));
    const account = privateKeyToAccount(key);
    if (check && account.address.toLowerCase() !== check) throw new SessionMismatchError();

    await saveKey(main, key);
    localStorage.setItem(checkName(main), account.address); // an address is not a secret
    return account;
  })();

  inFlight.set(main, work);
  return work.finally(() => inFlight.delete(main));
}

/**
 * The stored wallet, if there is one that can be trusted, and nothing else: no signature is ever requested here. This is
 * what a page load uses, so coming back to the site never prompts.
 */
export async function restoreSession(mainAddress: string): Promise<SessionAccount | undefined> {
  const main = mainAddress.toLowerCase();
  const stored = await loadKey(main);
  if (!stored) return undefined;
  const account = privateKeyToAccount(stored);
  const check = localStorage.getItem(checkName(main))?.toLowerCase();
  return !check || account.address.toLowerCase() === check ? account : undefined;
}

/** Forgets the stored key (and only that): the address check value stays, so recovery is still verified. */
export function clearSession(mainAddress: string): Promise<void> {
  return clearKey(mainAddress);
}
