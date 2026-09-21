/**
 * The bot's heartbeat: how the API's admin page learns that the watcher is alive and what the bot's wallet holds, without
 * either process knowing the other's address. The bot writes one Redis key per chain on a timer; the key expires, so a bot that
 * stops leaves nothing behind to be mistaken for a live one.
 */
export const HEARTBEAT_TTL_SECONDS = 45;
/** How often the bot writes it: well inside the lifetime, so one missed beat is not an outage. */
export const HEARTBEAT_EVERY_SECONDS = 15;

export const heartbeatKey = (chain: string): string => `bot:heartbeat:${chain}`;

export interface Heartbeat {
  /** Unix seconds: when the process started. */
  since: string;
  /** Unix seconds: when it last said so. */
  at: string;
  address?: string;
  /** Wei. Absent if the bot could not read it. */
  balance?: string;
}

const whole = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);

/** What was stored under the key, checked: anything that is not a heartbeat is nothing, and a bad field is dropped, not passed on. */
export function parseHeartbeat(raw: string | null | undefined): Heartbeat | undefined {
  if (!raw) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (!whole(v.since) || !whole(v.at)) return undefined;
  return {
    since: v.since,
    at: v.at,
    ...(typeof v.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(v.address) ? { address: v.address } : {}),
    ...(whole(v.balance) ? { balance: v.balance } : {}),
  };
}
