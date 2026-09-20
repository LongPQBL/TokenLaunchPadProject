import { describe, expect, it, vi } from "vitest";
import { createLiveClient, type LiveSocket } from "./client";

const T1 = "0x00000000000000000000000000000000000000b1";
const T2 = "0x00000000000000000000000000000000000000b2";

/** A socket that records what is sent and lets the test play the server's part. */
function fakeSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const sent: { event: string; args: unknown[] }[] = [];
  const socket = {
    connected: false,
    on: (event: string, fn: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off: (event: string, fn: (...args: unknown[]) => void) => void handlers.get(event)?.delete(fn),
    emit: (event: string, ...args: unknown[]) => {
      sent.push({ event, args });
      const ack = args.at(-1);
      if (typeof ack === "function") (ack as (r: unknown) => void)({ ok: true });
    },
    connect: vi.fn(() => {}),
    disconnect: vi.fn(() => {}),
  };
  const fire = (event: string, ...args: unknown[]) => handlers.get(event)?.forEach((fn) => fn(...args));
  return {
    socket: socket as unknown as LiveSocket & typeof socket,
    sent,
    up: () => {
      socket.connected = true;
      fire("connect");
    },
    down: () => {
      socket.connected = false;
      fire("disconnect");
    },
    message: (payload: unknown) => fire("event", payload),
  };
}

const trade = (token: string, n = 1) => ({ type: "trade", chain: "sepolia", token, txHash: `0x${n}`, logIndex: 0 });
const subscribes = (s: ReturnType<typeof fakeSocket>) => s.sent.filter((m) => m.event === "subscribe").map((m) => m.args[0]);

describe("createLiveClient", () => {
  it("connects only when something wants to listen", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    expect(s.socket.connect).not.toHaveBeenCalled();
    client.subscribe(`token:sepolia:${T1}`, () => {});
    expect(s.socket.connect).toHaveBeenCalledOnce();
  });

  it("asks to join the room once the connection is up", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    client.subscribe(`token:sepolia:${T1}`, () => {});
    expect(subscribes(s)).toEqual([]); // not connected yet
    s.up();
    expect(subscribes(s)).toEqual([`token:sepolia:${T1}`]);
  });

  it("delivers a trade to the handler of that token's room, and not to another token's", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    const a = vi.fn();
    const b = vi.fn();
    client.subscribe(`token:sepolia:${T1}`, a);
    client.subscribe(`token:sepolia:${T2}`, b);
    s.up();
    s.message(trade(T1));
    expect(a).toHaveBeenCalledWith(trade(T1));
    expect(b).not.toHaveBeenCalled();
  });

  it("delivers a trade to the global feed's handler, and a new token to the tokens room's", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    const feed = vi.fn();
    const created = vi.fn();
    client.subscribe("trades", feed);
    client.subscribe("tokens", created);
    s.up();
    s.message(trade(T1));
    s.message({ type: "created", chain: "sepolia", token: T1 });
    expect(feed).toHaveBeenCalledOnce();
    expect(created).toHaveBeenCalledOnce();
  });

  it("shares one server subscription between several listeners of a room, and leaves it when the last one goes", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    s.up();
    const off1 = client.subscribe("trades", () => {});
    const off2 = client.subscribe("trades", () => {});
    expect(subscribes(s)).toEqual(["trades"]);
    off1();
    expect(s.sent.filter((m) => m.event === "unsubscribe")).toEqual([]);
    off2();
    expect(s.sent.filter((m) => m.event === "unsubscribe").map((m) => m.args[0])).toEqual(["trades"]);
  });

  it("stops delivering to a handler that has unsubscribed", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    const handler = vi.fn();
    s.up();
    const off = client.subscribe(`token:sepolia:${T1}`, handler);
    off();
    s.message(trade(T1));
    expect(handler).not.toHaveBeenCalled();
  });

  it("joins the rooms again after a reconnect, and tells listeners so they can backfill what was missed", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    const backfill = vi.fn();
    client.onReconnect(backfill);
    client.subscribe(`token:sepolia:${T1}`, () => {});
    s.up();
    expect(backfill).not.toHaveBeenCalled(); // the first connection is not a reconnection
    s.down();
    s.up();
    expect(subscribes(s)).toEqual([`token:sepolia:${T1}`, `token:sepolia:${T1}`]);
    expect(backfill).toHaveBeenCalledOnce();
  });

  it("reports whether the connection is up, and when it changes", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    const changes: boolean[] = [];
    client.onStatus((up) => changes.push(up));
    client.subscribe("trades", () => {});
    expect(client.isConnected()).toBe(false);
    s.up();
    s.down();
    expect(changes).toEqual([true, false]);
    expect(client.isConnected()).toBe(false);
  });

  it("drops what is not a message of ours: a payload with no type, a string, null", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket });
    const handler = vi.fn();
    client.subscribe("trades", handler);
    s.up();
    for (const junk of [null, undefined, "x", 5, {}, { type: 7 }, []]) s.message(junk); // (what a trade must contain is the listener's check)
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not let one listener's failure stop the others", () => {
    const s = fakeSocket();
    const client = createLiveClient({ socket: s.socket, onError: () => {} });
    const good = vi.fn();
    client.subscribe("trades", () => {
      throw new Error("boom");
    });
    client.subscribe("trades", good);
    s.up();
    s.message(trade(T1));
    expect(good).toHaveBeenCalledOnce();
  });

  it("closes the connection when asked", () => {
    const s = fakeSocket();
    createLiveClient({ socket: s.socket }).close();
    expect(s.socket.disconnect).toHaveBeenCalledOnce();
  });
});
