import type { Address } from "viem";
import type { Api } from "../api";

const MAX_REMEMBERED = 500;
const key = (main: string) => `vezta.session.${main.toLowerCase()}.tokens`;

/** Tokens this browser has traded from the session wallet: a second source for withdrawal, in case the index is late or down. */
export function rememberedTokens(main: string): Address[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(main)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is Address => typeof t === "string" && /^0x[0-9a-fA-F]{40}$/.test(t)) : [];
  } catch {
    return [];
  }
}

export function rememberToken(main: string, token: string): void {
  try {
    const list = rememberedTokens(main);
    if (list.some((t) => t.toLowerCase() === token.toLowerCase())) return;
    localStorage.setItem(key(main), JSON.stringify([...list, token.toLowerCase()].slice(-MAX_REMEMBERED)));
  } catch {
    /* storage blocked: the index is still there */
  }
}

/**
 * Every token the session wallet might hold: what the index lists for its address, plus what this browser remembers
 * trading. Neither has to be right on its own, because withdrawal reads each balance from the chain. An index that is
 * late or down costs nothing but its half of the list.
 */
export async function listCandidateTokens({
  api,
  chain,
  sessionAddress,
  main,
}: {
  api: Api;
  chain: string;
  sessionAddress: string;
  main: string;
}): Promise<Address[]> {
  const fromIndex = await api.holdings(chain, sessionAddress).then(
    (r) => r.items.map((i) => i.token as Address),
    () => [] as Address[],
  );
  const all = [...fromIndex, ...rememberedTokens(main)];
  return [...new Map(all.map((t) => [t.toLowerCase(), t])).values()];
}
