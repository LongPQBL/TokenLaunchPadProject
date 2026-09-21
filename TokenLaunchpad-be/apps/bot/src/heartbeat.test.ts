import { HEARTBEAT_TTL_SECONDS, heartbeatKey, parseHeartbeat } from "@vezta/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHeartbeat } from "./heartbeat";

const ADDRESS = "0x00000000000000000000000000000000000000b1";

function setup(over: { getBalance?: () => Promise<bigint>; set?: (key: string, value: string, ttl: number) => Promise<unknown> } = {}) {
  const writes: { key: string; value: string; ttl: number }[] = [];
  const errors: unknown[] = [];
  const heartbeat = createHeartbeat({
    chain: "sepolia",
    address: ADDRESS,
    getBalance: over.getBalance ?? (async () => 5_000_000_000_000_000_000n),
    set: over.set ?? (async (key, value, ttl) => void writes.push({ key, value, ttl })),
    onError: (e) => errors.push(e),
  });
  return { heartbeat, writes, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-21T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const T0 = Math.floor(new Date("2026-09-21T10:00:00Z").getTime() / 1000);

describe("createHeartbeat", () => {
  it("writes the chain's key with when the process started, when it last spoke, its wallet and its balance in wei", async () => {
    const { heartbeat, writes } = setup();
    await heartbeat.beat();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe(heartbeatKey("sepolia"));
    expect(writes[0]!.ttl).toBe(HEARTBEAT_TTL_SECONDS);
    expect(parseHeartbeat(writes[0]!.value)).toEqual({ since: String(T0), at: String(T0), address: ADDRESS, balance: "5000000000000000000" });
  });

  it("keeps the start time and moves the last-spoke time on", async () => {
    const { heartbeat, writes } = setup();
    await heartbeat.beat();
    vi.setSystemTime(new Date("2026-09-21T10:00:15Z"));
    await heartbeat.beat();
    expect(parseHeartbeat(writes[1]!.value)).toMatchObject({ since: String(T0), at: String(T0 + 15) });
  });

  it("still speaks, without a balance, when the balance cannot be read: being alive matters more than the figure", async () => {
    const { heartbeat, writes, errors } = setup({ getBalance: async () => Promise.reject(new Error("rpc down")) });
    await heartbeat.beat();
    expect(parseHeartbeat(writes[0]!.value)).toEqual({ since: String(T0), at: String(T0), address: ADDRESS });
    expect(errors).toHaveLength(0); // a balance that cannot be read is not the heartbeat's failure
  });

  it("does not wait for a balance that never comes", async () => {
    const { heartbeat, writes } = setup({ getBalance: () => new Promise<bigint>(() => {}) });
    const beat = heartbeat.beat();
    await vi.advanceTimersByTimeAsync(6_000);
    await beat;
    expect(parseHeartbeat(writes[0]!.value)?.balance).toBeUndefined();
  });

  it("reports a failed write and does not throw: Redis being down must not stop the bot", async () => {
    const { heartbeat, errors } = setup({ set: async () => Promise.reject(new Error("redis down")) });
    await expect(heartbeat.beat()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("beats at once, then every interval, and stops when told", async () => {
    const { heartbeat, writes } = setup();
    const stop = heartbeat.start(15);
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(writes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writes).toHaveLength(4);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(writes).toHaveLength(4);
  });

  it("does not start a beat while the last is still going", async () => {
    let release!: () => void;
    let calls = 0;
    const { heartbeat } = setup({
      set: () => {
        calls += 1;
        return new Promise<void>((resolve) => (release = resolve));
      },
    });
    const stop = heartbeat.start(15);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    release();
    stop();
  });

  it("keeps beating after a failure", async () => {
    let fail = true;
    const writes: string[] = [];
    const { heartbeat } = setup({
      set: async (_key, value) => {
        if (fail) throw new Error("redis down");
        writes.push(value);
      },
    });
    const stop = heartbeat.start(15);
    await vi.advanceTimersByTimeAsync(0);
    fail = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(writes).toHaveLength(1);
    stop();
  });
});
