import { describe, expect, it, vi } from "vitest";
import { readHeartbeat, readIndexerBlock } from "./sources.js";

const respond = (body: unknown, init: { status?: number } = {}) => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: init.status ?? 200 }));

describe("readIndexerBlock", () => {
  const status = { sepolia: { id: 11155111, block: { number: 1234, timestamp: 1_700_000_000 } }, mainnet: { id: 1, block: { number: 99, timestamp: 1 } } };

  it("reads the block the indexer has reached on the chain we serve, not another's", async () => {
    const fetchImpl = respond(status);
    expect(await readIndexerBlock("http://indexer:42069/", 11155111, fetchImpl)).toBe(1234n);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("http://indexer:42069/status");
  });

  it("is nothing when the indexer does not list the chain, sends something else, refuses, or cannot be reached", async () => {
    expect(await readIndexerBlock("http://i", 5, respond(status))).toBeUndefined();
    expect(await readIndexerBlock("http://i", 11155111, respond({ sepolia: { id: 11155111, block: { number: "x" } } }))).toBeUndefined();
    expect(await readIndexerBlock("http://i", 11155111, respond("nope"))).toBeUndefined();
    expect(await readIndexerBlock("http://i", 11155111, respond(status, { status: 503 }))).toBeUndefined();
    expect(await readIndexerBlock("http://i", 11155111, (async () => Promise.reject(new Error("refused"))))).toBeUndefined();
  });

  it("is nothing when no indexer is configured", async () => {
    expect(await readIndexerBlock(undefined, 11155111, respond(status))).toBeUndefined();
  });

  it("does not follow a redirect to somewhere else: it asks the configured host and no other", async () => {
    const fetchImpl = respond(status);
    await readIndexerBlock("http://i", 11155111, fetchImpl);
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });
});

describe("readHeartbeat", () => {
  it("reads the chain's key and parses it", async () => {
    const get = vi.fn<(key: string) => Promise<string | null>>(async () => JSON.stringify({ since: "1", at: "2", balance: "3" }));
    expect(await readHeartbeat(get, "sepolia")).toEqual({ since: "1", at: "2", balance: "3" });
    expect(get).toHaveBeenCalledWith("bot:heartbeat:sepolia");
  });

  it("is nothing when the key is gone (the bot stopped), or is not a heartbeat, or Redis fails, or there is no Redis", async () => {
    expect(await readHeartbeat(async () => null, "sepolia")).toBeUndefined();
    expect(await readHeartbeat(async () => "garbage", "sepolia")).toBeUndefined();
    expect(await readHeartbeat(async () => Promise.reject(new Error("down")), "sepolia")).toBeUndefined();
    expect(await readHeartbeat(undefined, "sepolia")).toBeUndefined();
  });
});
