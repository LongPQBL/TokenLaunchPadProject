import { describe, expect, it } from "vitest";
import { loadBotConfig } from "./config";

const KEY = `0x${"11".repeat(32)}`;
const base = { RPC_URL: "https://rpc.example/v1", BOT_PRIVATE_KEY: KEY };

const messageOf = (env: Record<string, string | undefined>) => {
  try {
    loadBotConfig(env);
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

describe("loadBotConfig", () => {
  it("reads the RPC and the key, with sensible defaults for the rest", () => {
    const c = loadBotConfig(base);
    expect(c).toMatchObject({ rpcUrl: "https://rpc.example/v1", privateKey: KEY, pollMs: 4_000, catchUpMinutes: 10, redisUrl: undefined });
  });

  it("requires an RPC url and a key", () => {
    expect(() => loadBotConfig({ BOT_PRIVATE_KEY: KEY })).toThrow(/RPC_URL/);
    expect(() => loadBotConfig({ RPC_URL: base.RPC_URL })).toThrow(/BOT_PRIVATE_KEY/);
  });

  it("refuses an RPC that is not http(s)", () => {
    expect(() => loadBotConfig({ ...base, RPC_URL: "ftp://x" })).toThrow(/RPC_URL/);
    expect(() => loadBotConfig({ ...base, RPC_URL: "nonsense" })).toThrow(/RPC_URL/);
  });

  it("refuses a key that is not 32 bytes of hex, WITHOUT printing it", () => {
    for (const bad of ["0x1234", "not hex", `0x${"zz".repeat(32)}`, KEY.slice(2)]) {
      const message = messageOf({ ...base, BOT_PRIVATE_KEY: bad });
      expect(message, bad).toMatch(/BOT_PRIVATE_KEY/);
      expect(message).not.toContain(bad);
    }
  });

  it("refuses the well-known Anvil keys: bots sweep any ETH that reaches them", () => {
    const anvil0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const message = messageOf({ ...base, BOT_PRIVATE_KEY: anvil0 });
    expect(message).toMatch(/well-known/);
    expect(message).not.toContain(anvil0);
  });

  it("reads optional numbers and the Redis url, and rejects nonsense", () => {
    const c = loadBotConfig({ ...base, POLL_MS: "1000", CATCH_UP_MINUTES: "5", REDIS_URL: "redis://localhost:6390" });
    expect(c).toMatchObject({ pollMs: 1_000, catchUpMinutes: 5, redisUrl: "redis://localhost:6390" });
    expect(() => loadBotConfig({ ...base, POLL_MS: "0" })).toThrow(/POLL_MS/);
    expect(loadBotConfig(base).logRange).toBeUndefined(); // not set: each part keeps its own default
    expect(loadBotConfig({ ...base, LOG_RANGE_BLOCKS: "10" }).logRange).toBe(10n);
    for (const bad of ["0", "-5", "abc", "1.5"]) expect(() => loadBotConfig({ ...base, LOG_RANGE_BLOCKS: bad }), bad).toThrow(/LOG_RANGE_BLOCKS/);
    expect(() => loadBotConfig({ ...base, CATCH_UP_MINUTES: "-1" })).toThrow(/CATCH_UP_MINUTES/);
    expect(() => loadBotConfig({ ...base, REDIS_URL: "http://x" })).toThrow(/REDIS_URL/);
  });
});
