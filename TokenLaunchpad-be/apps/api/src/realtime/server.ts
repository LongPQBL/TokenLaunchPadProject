import type { Server as HttpServer } from "node:http";
import { Redis } from "ioredis";
import { Server, type Socket } from "socket.io";
import { parseRoom, ROOMS_PER_SOCKET } from "./rooms.js";

export interface RealtimeOptions {
  redisUrl: string;
  /** Origins allowed to open a websocket. Never "*". */
  corsOrigins: string[];
  /** Chain slugs that have rooms. */
  chains: string[];
  /**
   * The tokens that are hidden right now, as `<chain slug>:<lower-case address>`. Asked for on every message, so it must be
   * cheap (a set kept fresh elsewhere). Nothing about a hidden token is delivered, in the global feeds or its own room.
   */
  hiddenTokens?: () => ReadonlySet<string>;
  onError?: (error: unknown) => void;
}

type Ack = (result: { ok: boolean; joined?: string[]; error?: string }) => void;

/**
 * Live updates. The watcher publishes to Redis; EVERY API instance subscribes to Redis itself and delivers to the clients
 * connected to IT (`io.local`). That is what makes "add another API instance" safe: each client hangs off exactly one
 * instance, so it gets exactly one copy. (Broadcasting through a cross-instance adapter as well would give every client one
 * copy per instance.) Clients can join only the rooms parseRoom allows, and a room is never created by asking for one.
 *
 * Nothing is replayed. A message sent while a client was away is gone, so a client that reconnects refetches (Task 10).
 * If Redis is down, websockets stay open and quiet; when it returns, delivery resumes by itself.
 */
export function attachRealtime(httpServer: HttpServer, opts: RealtimeOptions) {
  const onError = opts.onError ?? ((e: unknown) => console.error(e));
  const io = new Server(httpServer, {
    cors: { origin: opts.corsOrigins, credentials: true },
    maxHttpBufferSize: 16 * 1024, // subscribe requests are tiny
    serveClient: false,
  });

  function joinedRooms(socket: Socket): number {
    return [...socket.rooms].filter((r) => r !== socket.id).length;
  }

  io.on("connection", (socket) => {
    socket.on("subscribe", (request: unknown, ack?: Ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const asked = Array.isArray(request) ? request : [request];
      if (asked.length === 0 || asked.length > ROOMS_PER_SOCKET) return reply({ ok: false, error: "unknown_room" });

      const rooms = asked.map((name) => parseRoom(name, opts.chains));
      // All or nothing: one bad name and nothing is joined, so a client is never half-subscribed without knowing.
      if (rooms.some((r) => r === undefined)) return reply({ ok: false, error: "unknown_room" });

      const wanted = [...new Set(rooms as string[])];
      const fresh = wanted.filter((r) => !socket.rooms.has(r));
      if (joinedRooms(socket) + fresh.length > ROOMS_PER_SOCKET) return reply({ ok: false, error: "too_many_rooms" });
      void socket.join(wanted);
      reply({ ok: true, joined: wanted });
    });

    socket.on("unsubscribe", (request: unknown, ack?: Ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      for (const name of Array.isArray(request) ? request : [request]) {
        const room = parseRoom(name, opts.chains);
        if (room) void socket.leave(room);
      }
      reply({ ok: true });
    });
    // Leaving on disconnect is socket.io's own: the rooms are gone with the socket.
  });

  // Subscribing needs its own connection: a Redis connection in subscriber mode can do nothing else. ioredis re-subscribes
  // by itself after a reconnect.
  const subscriber = new Redis(opts.redisUrl, { retryStrategy: (times) => Math.min(times * 200, 5_000) });
  subscriber.on("error", (e) => onError(e));
  void subscriber.subscribe("tokens", "trades").catch(onError);
  void subscriber.psubscribe("token:*").catch(onError);

  /**
   * A message about a hidden token, which no page should draw. The announcement that a token WAS hidden is the exception: it
   * is how a page that already shows the token learns to stop.
   */
  function isHiddenToken(payload: unknown): boolean {
    const hidden = opts.hiddenTokens?.();
    if (!hidden || hidden.size === 0 || typeof payload !== "object" || payload === null) return false;
    const { type, chain, token } = payload as { type?: unknown; chain?: unknown; token?: unknown };
    if (type === "token_hidden" || typeof chain !== "string" || typeof token !== "string") return false;
    return hidden.has(`${chain}:${token.toLowerCase()}`);
  }

  function deliver(channel: string, raw: string) {
    // The channel is trusted no more than a client's room name: only channels that could be rooms are delivered to.
    const room = parseRoom(channel, opts.chains);
    if (!room) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return; // not ours to deliver
    }
    if (isHiddenToken(payload)) return;
    io.local.to(room).emit("event", payload);
  }
  subscriber.on("message", deliver);
  subscriber.on("pmessage", (_pattern, channel, raw) => deliver(channel, raw));

  return {
    io,
    async close() {
      subscriber.disconnect();
      await io.close();
    },
  };
}
