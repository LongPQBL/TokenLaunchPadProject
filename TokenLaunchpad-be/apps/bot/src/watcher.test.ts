import { launchpadAbi, tokenFactoryAbi } from "@vezta/abi";
import { encodeAbiParameters, encodeEventTopics, getAddress, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createWatcher } from "./watcher";

const LAUNCHPAD = "0x00000000000000000000000000000000000000c3" as Address;
const FACTORY = "0x00000000000000000000000000000000000000d4" as Address;
const TOKEN = getAddress("0x00000000000000000000000000000000000000b2"); // checksummed on purpose: the watcher lower-cases it
const USER = "0x00000000000000000000000000000000000000a1" as Address;
const PAIR = "0x00000000000000000000000000000000000000f9" as Address;
const WETH = "0x00000000000000000000000000000000000000e5" as Address;

const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
  blockHash: Hex;
  transactionIndex: number;
  removed: false;
}
const base = (address: Address, blockNumber: bigint, n: number, logIndex = 0) => ({ address, blockNumber, transactionHash: tx(n), logIndex, blockHash: tx(999), transactionIndex: 0, removed: false as const });

function tradeLog(block: bigint, n: number, logIndex = 0, over: { isBuy?: boolean } = {}): RawLog {
  const topics = encodeEventTopics({ abi: launchpadAbi, eventName: "Trade", args: { mint: TOKEN, user: USER } });
  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [900n, 10n ** 27n, over.isBuy ?? true, 1_700_000_000n, 111n, 222n, 9n, 5n],
  );
  return { ...base(LAUNCHPAD, block, n, logIndex), topics: topics as Hex[], data };
}
function completeLog(block: bigint, n: number): RawLog {
  const topics = encodeEventTopics({ abi: launchpadAbi, eventName: "Complete", args: { user: USER, mint: TOKEN } });
  return { ...base(LAUNCHPAD, block, n), topics: topics as Hex[], data: encodeAbiParameters([{ type: "uint256" }], [1_700_000_001n]) };
}
function migratedLog(block: bigint, n: number): RawLog {
  const topics = encodeEventTopics({ abi: launchpadAbi, eventName: "Migrated", args: { mint: TOKEN, pair: PAIR } });
  return { ...base(LAUNCHPAD, block, n), topics: topics as Hex[], data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [50n, 60n]) };
}
function createdLog(block: bigint, n: number): RawLog {
  const topics = encodeEventTopics({ abi: tokenFactoryAbi, eventName: "TokenCreated", args: { token: TOKEN, creator: USER, quoteToken: WETH } });
  return { ...base(FACTORY, block, n), topics: topics as Hex[], data: encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "string" }], ["Demo", "DEMO", "ipfs://bafyabcde"]) };
}

function setup(over: { head?: bigint; logs?: RawLog[]; logRange?: bigint; publish?: (channel: string, message: string) => Promise<unknown> } = {}) {
  const state = { head: over.head ?? 100n, logs: over.logs ?? [] };
  const asked: { fromBlock: bigint; toBlock: bigint }[] = [];
  const published: { channel: string; message: Record<string, unknown> }[] = [];
  const publishFn = over.publish ?? (async (channel: string, message: string) => void published.push({ channel, message: JSON.parse(message) }));
  const migrator = { handleComplete: vi.fn<(token: Address) => Promise<"migrated">>(async () => "migrated") };
  const errors: string[] = [];
  const watcher = createWatcher({
    publicClient: {
      getBlockNumber: async () => state.head,
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        asked.push({ fromBlock, toBlock });
        return state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
    } as never,
    launchpad: LAUNCHPAD,
    factory: FACTORY,
    chain: "sepolia",
    publish: publishFn,
    migrator,
    logRange: over.logRange,
    onError: (e) => errors.push(String(e)),
  });
  return { watcher, state, asked, published, migrator, errors };
}

const on = <T extends { channel: string }>(p: T[], channel: string) => p.filter((x) => x.channel === channel);

describe("watcher: what it publishes", () => {
  it("publishes a trade once to the global feed and once to the token's channel, every amount a string", async () => {
    const s = setup({ head: 100n, logs: [tradeLog(101n, 1)] });
    await s.watcher.poll(); // first poll: starts from the head
    s.state.head = 101n;
    await s.watcher.poll();

    expect(on(s.published, "trades")).toHaveLength(1);
    const token = on(s.published, `token:sepolia:${TOKEN.toLowerCase()}`);
    expect(token).toHaveLength(1);
    expect(token[0]!.message).toEqual({
      type: "trade",
      id: `${tx(1)}-0`,
      chain: "sepolia",
      token: TOKEN.toLowerCase(),
      trader: USER.toLowerCase(),
      isBuy: true,
      quoteAmount: "900",
      tokenAmount: (10n ** 27n).toString(),
      timestamp: "1700000000",
      virtualQuoteReserves: "111",
      virtualTokenReserves: "222",
      fee: "9",
      launchTax: "5",
      blockNumber: "101",
      txHash: tx(1),
      logIndex: 0,
    });
    expect(on(s.published, "trades")[0]!.message).toEqual(token[0]!.message);
  });

  it("publishes Complete and Migrated to the token's channel, and TokenCreated to the tokens channel", async () => {
    const s = setup({ head: 100n, logs: [completeLog(101n, 2), migratedLog(102n, 3), createdLog(103n, 4)] });
    await s.watcher.poll();
    s.state.head = 103n;
    await s.watcher.poll();

    const channel = `token:sepolia:${TOKEN.toLowerCase()}`;
    expect(on(s.published, channel).map((p) => p.message.type)).toEqual(["complete", "migrated"]);
    expect(on(s.published, channel)[1]!.message).toMatchObject({ pair: PAIR.toLowerCase() });
    expect(on(s.published, "tokens")).toHaveLength(1);
    expect(on(s.published, "tokens")[0]!.message).toMatchObject({ type: "created", token: TOKEN.toLowerCase(), creator: USER.toLowerCase(), name: "Demo", ticker: "DEMO", metadataURI: "ipfs://bafyabcde" });
    expect(on(s.published, "trades")).toHaveLength(0); // only trades go to the global feed
  });

  it("hands a Complete to the migration bot, in the same process", async () => {
    const s = setup({ head: 100n, logs: [completeLog(101n, 2)] });
    await s.watcher.poll();
    s.state.head = 101n;
    await s.watcher.poll();
    expect(s.migrator.handleComplete).toHaveBeenCalledWith(TOKEN);
  });

  it("does not publish an event twice when the same log is delivered again: it dedupes by txHash-logIndex", async () => {
    const s = setup({ head: 100n, logs: [tradeLog(101n, 1)] });
    await s.watcher.poll();
    s.state.head = 101n;
    await s.watcher.poll();
    s.state.head = 102n;
    await s.watcher.poll(); // re-reads the last blocks, and sees the same log again
    await s.watcher.poll();
    expect(on(s.published, "trades")).toHaveLength(1);
  });

  it("keeps two trades in one transaction apart: the log index is part of their identity", async () => {
    const s = setup({ head: 100n, logs: [tradeLog(101n, 1, 0), tradeLog(101n, 1, 1)] });
    await s.watcher.poll();
    s.state.head = 101n;
    await s.watcher.poll();
    expect(on(s.published, "trades")).toHaveLength(2);
  });

  it("hands Complete to the bot only once when it is delivered again", async () => {
    const s = setup({ head: 100n, logs: [completeLog(101n, 2)] });
    await s.watcher.poll();
    s.state.head = 101n;
    await s.watcher.poll();
    s.state.head = 103n;
    await s.watcher.poll();
    expect(s.migrator.handleComplete).toHaveBeenCalledOnce();
  });

  it("ignores logs it does not know, from either contract", async () => {
    const stranger: RawLog = { ...tradeLog(101n, 1), topics: ["0x" + "de".repeat(32) as Hex] };
    const s = setup({ head: 100n, logs: [stranger] });
    await s.watcher.poll();
    s.state.head = 101n;
    await expect(s.watcher.poll()).resolves.toBeUndefined();
    expect(s.published).toEqual([]);
  });
});

describe("watcher: keeping up", () => {
  it("starts from where the chain is now: old history is REST's job, and the bot's catch-up, not a flood of stale events", async () => {
    const s = setup({ head: 500n, logs: [tradeLog(10n, 1)] });
    await s.watcher.poll();
    expect(s.published).toEqual([]);
    expect(s.asked).toEqual([]);
  });

  it("re-reads a few recent blocks each time, so an event in a block that arrived late is not missed", async () => {
    const s = setup({ head: 100n });
    await s.watcher.poll();
    s.state.head = 110n;
    await s.watcher.poll();
    expect(s.asked[0]!.fromBlock).toBeLessThan(101n);
    expect(s.asked[0]!.toBlock).toBe(110n);
  });

  it("reads a long gap in bounded ranges", async () => {
    const s = setup({ head: 100n });
    await s.watcher.poll();
    s.state.head = 10_000n;
    await s.watcher.poll();
    for (const r of s.asked) expect(r.toBlock - r.fromBlock).toBeLessThanOrEqual(2_000n);
    expect(s.asked.at(-1)!.toBlock).toBe(10_000n);
  });

  // A provider on a free plan answers eth_getLogs for ten blocks at most, and refuses anything wider outright.
  it("reads no more blocks at a time than it is told the RPC allows", async () => {
    const s = setup({ head: 100n, logRange: 10n });
    await s.watcher.poll();
    s.state.head = 137n;
    await s.watcher.poll();
    expect(s.asked.length).toBeGreaterThan(1);
    for (const r of s.asked) expect(r.toBlock - r.fromBlock).toBeLessThan(10n); // at most 10 blocks, both ends counted
    expect(s.asked.at(-1)!.toBlock).toBe(137n);
    for (let i = 1; i < s.asked.length; i++) expect(s.asked[i]!.fromBlock).toBe(s.asked[i - 1]!.toBlock + 1n);
  });

  it("does nothing when there is no new block", async () => {
    const s = setup({ head: 100n });
    await s.watcher.poll();
    await s.watcher.poll();
    expect(s.asked).toEqual([]);
  });

  it("remembers only a bounded number of events", async () => {
    const logs = Array.from({ length: 12_000 }, (_, i) => tradeLog(101n, i + 1));
    const s = setup({ head: 100n, logs });
    await s.watcher.poll();
    s.state.head = 101n;
    await s.watcher.poll();
    expect(s.watcher.rememberedCount()).toBeLessThanOrEqual(10_000);
  });
});

describe("watcher: when things break", () => {
  it("keeps watching, and keeps the bot going, when Redis is down", async () => {
    const s = setup({
      head: 100n,
      logs: [completeLog(101n, 2)],
      publish: async () => {
        throw new Error("ECONNREFUSED redis");
      },
    });
    await s.watcher.poll();
    s.state.head = 101n;
    await expect(s.watcher.poll()).resolves.toBeUndefined();
    expect(s.migrator.handleComplete).toHaveBeenCalledWith(TOKEN);
    expect(s.errors.some((e) => e.includes("ECONNREFUSED"))).toBe(true);
  });

  it("publishes an event that failed to publish on a later pass, once Redis is back, and only once", async () => {
    let up = false;
    const delivered: string[] = [];
    const s = setup({
      head: 100n,
      logs: [tradeLog(101n, 1)],
      publish: async (channel, message) => {
        if (!up) throw new Error("down");
        delivered.push(channel + message);
      },
    });
    await s.watcher.poll();
    s.state.head = 101n;
    await s.watcher.poll(); // fails
    up = true;
    s.state.head = 102n;
    await s.watcher.poll(); // the overlap re-reads block 101
    await s.watcher.poll();
    expect(delivered.filter((d) => d.startsWith("trades"))).toHaveLength(1);
  });

  it("does not lose its place when the RPC fails: the next poll picks up where it was", async () => {
    const s = setup({ head: 100n, logs: [tradeLog(102n, 1)] });
    await s.watcher.poll();
    s.state.head = 102n;
    const original = s.state.logs;
    s.state.logs = null as never; // getLogs blows up
    await expect(s.watcher.poll()).rejects.toBeDefined();
    s.state.logs = original;
    await s.watcher.poll();
    expect(on(s.published, "trades")).toHaveLength(1);
  });

  it("start() keeps polling after a failed poll and reports it", async () => {
    let calls = 0;
    const errors: string[] = [];
    const watcher = createWatcher({
      publicClient: {
        getBlockNumber: async () => {
          calls++;
          if (calls === 2) throw new Error("rpc down");
          return 100n;
        },
        getLogs: async () => [],
      } as never,
      launchpad: LAUNCHPAD,
      factory: FACTORY,
      chain: "sepolia",
      publish: async () => {},
      migrator: { handleComplete: async () => "migrated" as const },
      onError: (e) => errors.push(String(e)),
    });
    const loop = watcher.start(5);
    await new Promise((r) => setTimeout(r, 80));
    loop.stop();
    expect(calls).toBeGreaterThan(3);
    expect(errors.some((e) => e.includes("rpc down"))).toBe(true);
  });
});
