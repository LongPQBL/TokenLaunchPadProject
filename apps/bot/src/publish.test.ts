import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRedis, type TestRedis } from "../test/redis";
import { createRedisPublisher } from "./publish";

let redis: TestRedis;
beforeAll(async () => {
  redis = await startRedis();
});
afterAll(() => redis.stop());

async function subscriber(channels: string[]) {
  const sub = new Redis(redis.url);
  const received: { channel: string; message: string }[] = [];
  sub.on("message", (channel, message) => received.push({ channel, message }));
  await sub.subscribe(...channels);
  return { received, close: () => sub.quit() };
}

const until = async (check: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

describe("createRedisPublisher", () => {
  it("delivers a message to whoever is subscribed to the channel, and only them", async () => {
    const wanted = await subscriber(["trades"]);
    const other = await subscriber(["tokens"]);
    const publisher = createRedisPublisher(redis.url);
    await publisher.publish("trades", JSON.stringify({ type: "trade" }));
    await until(() => wanted.received.length > 0);
    expect(wanted.received).toEqual([{ channel: "trades", message: '{"type":"trade"}' }]);
    expect(other.received).toEqual([]);
    await Promise.all([wanted.close(), other.close(), publisher.close()]);
  });

  it("stores a value under a key that expires by itself, so a bot that stops leaves nothing behind", async () => {
    const publisher = createRedisPublisher(redis.url);
    const reader = new Redis(redis.url);
    await publisher.set("bot:heartbeat:test", "alive", 30);
    expect(await reader.get("bot:heartbeat:test")).toBe("alive");
    const ttl = await reader.ttl("bot:heartbeat:test");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
    await Promise.all([reader.quit(), publisher.close()]);
  });

  it("fails fast when Redis is down instead of queueing messages without limit", async () => {
    const publisher = createRedisPublisher(redis.url);
    await publisher.publish("trades", "warm up");
    await redis.stop();
    const started = Date.now();
    await expect(publisher.publish("trades", "lost")).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(2_000);
    await redis.start();
    await publisher.close();
  });

  it("publishes again once Redis is back, without being rebuilt", async () => {
    const publisher = createRedisPublisher(redis.url);
    await publisher.publish("trades", "one");
    await redis.stop();
    await expect(publisher.publish("trades", "two")).rejects.toBeDefined();
    await redis.start();
    const sub = await subscriber(["trades"]);
    let delivered = false;
    for (let i = 0; i < 50 && !delivered; i++) {
      delivered = await publisher.publish("trades", "three").then(() => true, () => false);
      if (!delivered) await new Promise((r) => setTimeout(r, 100));
    }
    expect(delivered).toBe(true);
    await until(() => sub.received.some((m) => m.message === "three"));
    expect(sub.received.map((m) => m.message)).toContain("three");
    await Promise.all([sub.close(), publisher.close()]);
  });

  it("does not print Redis errors as unhandled crashes when the server is not there at all", async () => {
    const dead = createRedisPublisher("redis://127.0.0.1:1");
    await expect(dead.publish("trades", "x")).rejects.toBeDefined();
    await dead.close();
  });
});
