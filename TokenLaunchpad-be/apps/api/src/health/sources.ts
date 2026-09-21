import { heartbeatKey, parseHeartbeat, type Heartbeat } from "@vezta/shared";

/**
 * The block the indexer has reached on our chain, from Ponder's own /status. Anything unexpected is "unknown": an unreachable
 * indexer, a refusal, a body of another shape, a chain it does not list. It asks the configured host only and follows no
 * redirect, so the address in the environment is the only place this ever calls.
 */
export async function readIndexerBlock(baseUrl: string | undefined, chainId: number, fetchImpl: typeof fetch = fetch): Promise<bigint | undefined> {
  if (!baseUrl) return undefined;
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/status`, { redirect: "error", headers: { accept: "application/json" } });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return undefined;
    for (const entry of Object.values(body as Record<string, unknown>)) {
      const e = entry as { id?: unknown; block?: { number?: unknown } } | null;
      if (e && e.id === chainId && typeof e.block?.number === "number" && Number.isSafeInteger(e.block.number) && e.block.number >= 0) {
        return BigInt(e.block.number);
      }
    }
  } catch {
    /* unreachable, or not JSON: unknown */
  }
  return undefined;
}

/** The bot's last heartbeat for this chain, or nothing if it is gone, is not one, or Redis cannot be asked. */
export async function readHeartbeat(get: ((key: string) => Promise<string | null>) | undefined, chain: string): Promise<Heartbeat | undefined> {
  if (!get) return undefined;
  try {
    return parseHeartbeat(await get(heartbeatKey(chain)));
  } catch {
    return undefined;
  }
}
