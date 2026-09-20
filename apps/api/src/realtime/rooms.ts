/** One connection may not follow more than this many rooms: each is a subscription the server keeps for as long as it is open. */
export const ROOMS_PER_SOCKET = 20;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * The canonical name of a room a client may join, or undefined. The room name comes from a stranger, and a room is created
 * by joining it, so this is the whole list of what can exist: `tokens`, `trades`, and `token:<chain>:<address>` for a chain
 * that is configured and a well-formed address, lower-cased. Nothing else can be joined, and nothing is created by asking.
 */
export function parseRoom(name: unknown, chains: readonly string[]): string | undefined {
  if (typeof name !== "string") return undefined;
  if (name === "tokens" || name === "trades") return name;

  const parts = name.split(":");
  if (parts.length !== 3 || parts[0] !== "token") return undefined;
  const [, chain, address] = parts as [string, string, string];
  if (!chains.includes(chain) || !ADDRESS.test(address)) return undefined;
  return `token:${chain}:${address.toLowerCase()}`;
}
