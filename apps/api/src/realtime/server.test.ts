import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Redis } from "ioredis";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startRedis, type TestRedis } from "../../test/redis.js";
import { attachRealtime } from "./server.js";

const T1 = "0x00000000000000000000000000000000000000b1";
const T2 = "0x00000000000000000000000000000000000000b2";
const ORIGIN = "https://launchpad.test";

let redis: TestRedis;
beforeAll(async () => {
  redis = await startRedis();
});
afterAll(() => redis.stop());

const cleanup: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function startServer(opts: { corsOrigins?: string[] } = {}) {
  const http: HttpServer = createServer();
  const realtime = attachRealtime(http, { redisUrl: redis.url, corsOrigins: opts.corsOrigins ?? [ORIGIN], chains: ["sepolia"], onError: () => {} });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  cleanup.push(async () => {
    await realtime.close();
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
  });
  return { http, realtime, url };
}

async function client(url: string) {
  const socket: Socket = connect(url, { transports: ["websocket"], extraHeaders: { origin: ORIGIN }, reconnection: false });
  const events: unknown[] = [];
  socket.on("event", (e) => events.push(e));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  cleanup.push(() => socket.close());
  const join = (rooms: unknown) => new Promise<{ ok: boolean; joined?: string[]; error?: string }>((res) => socket.emit("subscribe", rooms, res));
  return { socket, events, join };
}

let publisher: Redis;
beforeAll(() => {
  publisher = new Redis(redis.url);
  publisher.on("error", () => {}); // it is stopped on purpose in one test
});
afterAll(() => {
  publisher.disconnect();
});
const publish = (channel: string, message: unknown) => publisher.publish(channel, typeof message === "string" ? message : JSON.stringify(message));
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
};

const trade = (token: string, n = 1) => ({ type: "trade", id: `0x${n}-0`, chain: "sepolia", token, quoteAmount: "900" });

describe("who receives what", () => {
  it("a client in a token's room receives that token's events and nothing else", async () => {
    const { url } = await startServer();
    const c = await client(url);
    expect(await c.join(`token:sepolia:${T1}`)).toEqual({ ok: true, joined: [`token:sepolia:${T1}`] });
    await settle(100);

    await publish(`token:sepolia:${T1}`, trade(T1));
    await publish(`token:sepolia:${T2}`, trade(T2)); // another token
    await publish("trades", trade(T1, 2)); // the global feed
    await settle();
    expect(c.events).toEqual([trade(T1)]);
  });

  it("the global rooms carry the global feeds", async () => {
    const { url } = await startServer();
    const c = await client(url);
    await c.join(["trades", "tokens"]);
    await settle(100);
    await publish("trades", trade(T1));
    await publish("tokens", { type: "created", token: T1 });
    await until(() => c.events.length === 2);
    expect(c.events).toEqual([trade(T1), { type: "created", token: T1 }]);
  });

  it("delivers each event once when a client is in the room twice (the same room asked for twice)", async () => {
    const { url } = await startServer();
    const c = await client(url);
    await c.join(`token:sepolia:${T1}`);
    await c.join(`token:sepolia:${T1.toUpperCase().replace("0X", "0x")}`);
    await settle(100);
    await publish(`token:sepolia:${T1}`, trade(T1));
    await settle();
    expect(c.events).toHaveLength(1);
  });

  it("a client that joins after a message does not get it: messages are not replayed, so the browser must backfill on reconnect", async () => {
    const { url } = await startServer();
    await publish(`token:sepolia:${T1}`, trade(T1));
    await settle(100);
    const c = await client(url);
    await c.join(`token:sepolia:${T1}`);
    await settle();
    expect(c.events).toEqual([]);
  });

  it("two API instances on one Redis deliver EXACTLY ONE copy to each client", async () => {
    const a = await startServer();
    const b = await startServer();
    const onA = await client(a.url);
    const onB = await client(b.url);
    await onA.join(`token:sepolia:${T1}`);
    await onB.join(`token:sepolia:${T1}`);
    await settle(150);
    await publish(`token:sepolia:${T1}`, trade(T1));
    await settle(400);
    expect(onA.events).toHaveLength(1);
    expect(onB.events).toHaveLength(1);
  });
});

describe("what may be joined", () => {
  it("rejects a room that is not one of the known kinds, and does not create it", async () => {
    const { url, realtime } = await startServer();
    const c = await client(url);
    for (const room of ["admin", "*", `token:mainnet:${T1}`, "token:sepolia:0x123", "token:*"]) {
      const result = await c.join(room);
      expect(result, room).toMatchObject({ ok: false, error: "unknown_room" });
    }
    expect([...realtime.io.sockets.adapter.rooms.keys()].filter((r) => r !== c.socket.id)).toEqual([]);
  });

  it("joins nothing at all when any one of the rooms asked for is unknown", async () => {
    const { url, realtime } = await startServer();
    const c = await client(url);
    expect(await c.join(["trades", "admin"])).toMatchObject({ ok: false });
    expect(realtime.io.sockets.adapter.rooms.has("trades")).toBe(false);
  });

  it("answers garbage instead of crashing", async () => {
    const { url } = await startServer();
    const c = await client(url);
    for (const junk of [undefined, null, 5, {}, [1, 2], "x".repeat(10_000)]) expect(await c.join(junk as never)).toMatchObject({ ok: false });
    // and it still works afterwards
    expect(await c.join("trades")).toMatchObject({ ok: true });
  });

  it("limits how many rooms one connection may follow", async () => {
    const { url } = await startServer();
    const c = await client(url);
    let refused = 0;
    for (let i = 0; i < 30; i++) {
      const token = `0x${i.toString(16).padStart(40, "0")}`;
      if (!(await c.join(`token:sepolia:${token}`)).ok) refused++;
    }
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThanOrEqual(15);
  });

  it("leaves a room on request, and then stops receiving", async () => {
    const { url } = await startServer();
    const c = await client(url);
    await c.join("trades");
    await new Promise<void>((res) => c.socket.emit("unsubscribe", "trades", () => res()));
    await settle(100);
    await publish("trades", trade(T1));
    await settle();
    expect(c.events).toEqual([]);
  });

  it("leaves no membership behind when a client disconnects", async () => {
    const { url, realtime } = await startServer();
    const c = await client(url);
    await c.join([`token:sepolia:${T1}`, "trades"]);
    expect(realtime.io.sockets.adapter.rooms.has("trades")).toBe(true);
    c.socket.close();
    await until(() => !realtime.io.sockets.adapter.rooms.has("trades"));
    expect(realtime.io.sockets.adapter.rooms.has("trades")).toBe(false);
    expect(realtime.io.sockets.adapter.rooms.has(`token:sepolia:${T1}`)).toBe(false);
  });
});

describe("what it does with what Redis sends", () => {
  it("ignores a message that is not JSON, and one on a channel it does not serve, and keeps working", async () => {
    const { url } = await startServer();
    const c = await client(url);
    await c.join("trades");
    await settle(100);
    await publish("trades", "this is not json");
    await publish("admin", { type: "x" });
    await publish("trades", trade(T1));
    await settle();
    expect(c.events).toEqual([trade(T1)]);
  });

  it("keeps serving after Redis goes away and comes back", async () => {
    const { url } = await startServer();
    const c = await client(url);
    await c.join("trades");
    await settle(150);
    await redis.stop();
    await settle(300);
    expect(c.socket.connected).toBe(true); // the websocket itself does not depend on Redis being up
    await redis.start();
    publisher.disconnect();
    publisher = new Redis(redis.url);
    publisher.on("error", () => {});
    for (let i = 0; i < 40 && c.events.length === 0; i++) {
      await publish("trades", trade(T1, i)).catch(() => 0);
      await settle(150);
    }
    expect(c.events.length).toBeGreaterThan(0);
  });
});

describe("who may connect", () => {
  it("answers a browser from an allowed origin, and gives a stranger's origin no permission", async () => {
    const { url } = await startServer({ corsOrigins: [ORIGIN] });
    const ok = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const evil = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never answers with a wildcard origin", async () => {
    const { url } = await startServer();
    const res = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, { headers: { origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});
