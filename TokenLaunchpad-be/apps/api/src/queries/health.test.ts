import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addr, seedToken, seedTrade } from "../../test/seed.js";
import { getSql } from "../db.js";
import { getHealth, type HealthDeps } from "./health.js";

const CHAIN_ID = 11155111;
const NOW = 1_800_000_000;
const deps = (over: HealthDeps = {}): HealthDeps => ({ now: () => NOW, ...over });
const heartbeat = { since: String(NOW - 3600), at: String(NOW - 5), address: addr(0xb07), balance: "123456789012345678901" };

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

describe("indexer lag", () => {
  it("is the chain's head minus the last block the indexer has handled", async () => {
    const h = await getHealth(CHAIN_ID, deps({ chainHead: async () => 1_000n, indexerBlock: async () => 990n }));
    expect(h.indexerLagBlocks).toBe(10);
  });

  it("is zero, never negative, when the indexer is ahead of a node that is a block behind", async () => {
    const h = await getHealth(CHAIN_ID, deps({ chainHead: async () => 1_000n, indexerBlock: async () => 1_002n }));
    expect(h.indexerLagBlocks).toBe(0);
  });

  it("is unknown, not zero, when either end cannot be read: a monitor must not say 'fine' about what it cannot see", async () => {
    expect((await getHealth(CHAIN_ID, deps({ indexerBlock: async () => 5n }))).indexerLagBlocks).toBeNull();
    expect((await getHealth(CHAIN_ID, deps({ chainHead: async () => 5n }))).indexerLagBlocks).toBeNull();
    expect((await getHealth(CHAIN_ID, deps({ chainHead: async () => 5n, indexerBlock: async () => undefined }))).indexerLagBlocks).toBeNull();
    expect((await getHealth(CHAIN_ID, deps({ chainHead: async () => 5n, indexerBlock: async () => Promise.reject(new Error("down")) }))).indexerLagBlocks).toBeNull();
    expect((await getHealth(CHAIN_ID, deps({ chainHead: async () => Promise.reject(new Error("rpc down")), indexerBlock: async () => 5n }))).indexerLagBlocks).toBeNull();
  });

  it("gives up on a dependency that does not answer, and still answers about the rest", async () => {
    const never = () => new Promise<bigint>(() => {});
    const started = Date.now();
    const h = await getHealth(CHAIN_ID, deps({ chainHead: never, indexerBlock: async () => 5n, timeoutMs: 50, heartbeat: async () => heartbeat }));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(h.indexerLagBlocks).toBeNull();
    expect(h.botBalance).toBe(heartbeat.balance);
  });
});

describe("the watcher and the bot", () => {
  it("says since when the watcher has been alive, and the bot's wallet and balance in wei, as strings", async () => {
    const h = await getHealth(CHAIN_ID, deps({ heartbeat: async () => heartbeat }));
    expect(h).toMatchObject({ watcherAliveSince: heartbeat.since, botAddress: heartbeat.address, botBalance: "123456789012345678901" });
    expect(typeof h.botBalance).toBe("string"); // wei do not fit a JavaScript number
  });

  it("says nothing is known when there is no heartbeat (the process is down, or Redis is)", async () => {
    for (const heartbeatFn of [undefined, async () => undefined, async () => Promise.reject(new Error("redis down"))]) {
      const h = await getHealth(CHAIN_ID, deps({ heartbeat: heartbeatFn }));
      expect(h).toMatchObject({ watcherAliveSince: null, botAddress: null, botBalance: null });
    }
  });

  it("keeps the rest of a heartbeat when the balance could not be read", async () => {
    const h = await getHealth(CHAIN_ID, deps({ heartbeat: async () => ({ ...heartbeat, balance: undefined }) }));
    expect(h).toMatchObject({ watcherAliveSince: heartbeat.since, botBalance: null });
  });
});

describe("failed metadata", () => {
  it("counts the tokens whose metadata was given up on, and nothing else", async () => {
    for (const [i, status] of (["invalid", "invalid", "pending", "ok", "hidden"] as const).entries()) {
      await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: addr(0x10 + i), uri: "ipfs://x", status } });
    }
    await prisma.tokenMetadata.create({ data: { chainId: 1, token: addr(0x20), uri: "ipfs://x", status: "invalid" } });
    expect((await getHealth(CHAIN_ID, deps())).failedMetadataCount).toBe(2);
  });

  it("is zero when there are none", async () => {
    expect((await getHealth(CHAIN_ID, deps())).failedMetadataCount).toBe(0);
  });
});

describe("stuck tokens", () => {
  const T = addr(0x31);
  const full = (over: Parameters<typeof seedToken>[0] extends infer P ? Partial<P> : never = {}) => seedToken({ address: T, name: "Full", ticker: "FULL", complete: true, migrated: false, createdAt: NOW - 10_000, ...over } as never);
  const tradeAt = (secondsAgo: number, token = T, logIndex = 0) => seedTrade({ token, blockNumber: 100 + logIndex, logIndex, timestamp: NOW - secondsAgo });
  const stuck = async () => (await getHealth(CHAIN_ID, deps())).stuckTokens;

  it("lists a curve that filled more than two minutes ago and has not migrated, since the trade that filled it", async () => {
    await full();
    await tradeAt(500, T, 0);
    await tradeAt(130, T, 1); // the one that filled it
    expect(await stuck()).toEqual([{ address: T, name: "Full", ticker: "FULL", completeSince: String(NOW - 130) }]);
  });

  it("does not list one that filled thirty seconds ago: the bot has had no time yet", async () => {
    await full();
    await tradeAt(30);
    expect(await stuck()).toEqual([]);
  });

  it("draws the line at two minutes", async () => {
    await full();
    await tradeAt(119);
    expect(await stuck()).toEqual([]);
    await getSql()`truncate launchpad.trade`;
    await tradeAt(121);
    expect(await stuck()).toHaveLength(1);
  });

  it("does not list one that has migrated, one that has not filled, or one a moderator hid", async () => {
    await full({ address: addr(0x32), migrated: true });
    await tradeAt(500, addr(0x32));
    await full({ address: addr(0x33), complete: false });
    await tradeAt(500, addr(0x33));
    await full({ address: addr(0x34) });
    await tradeAt(500, addr(0x34));
    await prisma.tokenMetadata.create({ data: { chainId: CHAIN_ID, token: addr(0x34), uri: "ipfs://x", status: "hidden" } });
    expect(await stuck()).toEqual([]);
  });

  it("falls back to when the token was made if it has no trades on record", async () => {
    await full({ createdAt: NOW - 500 });
    expect(await stuck()).toEqual([{ address: T, name: "Full", ticker: "FULL", completeSince: String(NOW - 500) }]);
  });

  it("lists the one stuck longest first, and only this chain's", async () => {
    await full({ address: addr(0x35) });
    await tradeAt(200, addr(0x35));
    await full({ address: addr(0x36) });
    await tradeAt(900, addr(0x36));
    await seedToken({ address: addr(0x37), chainId: 1, complete: true, createdAt: NOW - 10_000 });
    expect((await stuck()).map((t) => t.address)).toEqual([addr(0x36), addr(0x35)]);
  });
});
