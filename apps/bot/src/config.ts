export interface BotConfig {
  rpcUrl: string;
  /** Holds gas and nothing else. Never logged, never printed in an error. */
  privateKey: `0x${string}`;
  /** How often the watcher looks for new blocks. */
  pollMs: number;
  /** How often the bot re-scans for curves that completed without it noticing. */
  catchUpMinutes: number;
  /** Where events are published for the API's websockets. Optional: the bot migrates without it. */
  redisUrl?: string;
}

// The keys every Anvil install shares. A wallet on one of them can be drained by anyone, and on a fork it inherits
// whatever sweeper delegations bots have put there. A bot wallet must be its own.
const WELL_KNOWN = new Set([
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
]);

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number`);
  return n;
}

/** Everything the bot reads from the environment, checked once at start-up. */
export function loadBotConfig(env: Record<string, string | undefined> = process.env): BotConfig {
  const rpc = env.RPC_URL;
  if (!rpc) throw new Error("RPC_URL is required");
  try {
    const url = new URL(rpc);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("RPC_URL must be an http(s) URL");
  }

  const key = env.BOT_PRIVATE_KEY;
  if (!key) throw new Error("BOT_PRIVATE_KEY is required");
  // The message never contains the value: a wrong key pasted here is still a key.
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("BOT_PRIVATE_KEY must be 32 bytes of hex, starting with 0x");
  if (WELL_KNOWN.has(key.toLowerCase())) throw new Error("BOT_PRIVATE_KEY is a well-known test key: use a wallet of the bot's own");

  if (env.REDIS_URL !== undefined && !/^rediss?:\/\//.test(env.REDIS_URL)) throw new Error("REDIS_URL must start with redis:// or rediss://");

  return {
    rpcUrl: rpc,
    privateKey: key as `0x${string}`,
    pollMs: positiveInt("POLL_MS", env.POLL_MS, 4_000),
    catchUpMinutes: positiveInt("CATCH_UP_MINUTES", env.CATCH_UP_MINUTES, 10),
    redisUrl: env.REDIS_URL || undefined,
  };
}
