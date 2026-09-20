import { io } from "socket.io-client";

/** The few things of a socket.io client this module uses, so a test can stand in for it. */
export interface LiveSocket {
  connected: boolean;
  on(event: string, fn: (...args: unknown[]) => void): unknown;
  off(event: string, fn: (...args: unknown[]) => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  connect(): unknown;
  disconnect(): unknown;
}

export type LiveHandler = (payload: LiveMessage) => void;
/** A message from the watcher. Only its shape is known here; the listener checks the rest of it. */
export type LiveMessage = { type: string; chain?: string; token?: string } & Record<string, unknown>;

/** Which rooms a message belongs to, from what it says: the server sends the payload alone. */
function roomsOf(m: LiveMessage): string[] {
  const token = typeof m.token === "string" ? m.token.toLowerCase() : undefined;
  const tokenRoom = token && typeof m.chain === "string" ? `token:${m.chain}:${token}` : undefined;
  switch (m.type) {
    case "trade":
      return ["trades", ...(tokenRoom ? [tokenRoom] : [])];
    case "complete":
    case "migrated":
      return tokenRoom ? [tokenRoom] : [];
    case "created":
      return ["tokens"];
    default:
      return [];
  }
}

const isMessage = (x: unknown): x is LiveMessage => typeof x === "object" && x !== null && !Array.isArray(x) && typeof (x as { type?: unknown }).type === "string";

/**
 * The browser's one connection to live updates. Rooms are shared and counted: however many components listen to a room,
 * the server is asked once, and it is left when the last one goes. It connects when something first listens. After a
 * reconnection it joins the rooms again and says so (`onReconnect`), because nothing that happened while the
 * connection was down is ever resent: whoever cares must refetch.
 */
export function createLiveClient({ socket, onError }: { socket: LiveSocket; onError?: (e: unknown) => void }) {
  const report = onError ?? ((e: unknown) => console.error(e));
  const handlers = new Map<string, Set<LiveHandler>>();
  const statusListeners = new Set<(up: boolean) => void>();
  const reconnectListeners = new Set<() => void>();
  let wasConnected = false;
  let started = false;

  const join = (room: string) => void socket.emit("subscribe", room, () => {});
  const leave = (room: string) => void socket.emit("unsubscribe", room, () => {});

  socket.on("connect", () => {
    for (const room of handlers.keys()) join(room);
    for (const fn of statusListeners) fn(true);
    if (wasConnected) for (const fn of reconnectListeners) fn();
    wasConnected = true;
  });
  socket.on("disconnect", () => {
    for (const fn of statusListeners) fn(false);
  });
  socket.on("event", (payload: unknown) => {
    if (!isMessage(payload)) return;
    for (const room of roomsOf(payload)) {
      for (const handler of handlers.get(room) ?? []) {
        try {
          handler(payload);
        } catch (e) {
          report(e); // one listener's failure must not stop the others
        }
      }
    }
  });

  return {
    /** Listens to a room. Returns how to stop. */
    subscribe(room: string, handler: LiveHandler): () => void {
      let set = handlers.get(room);
      if (!set) {
        set = new Set();
        handlers.set(room, set);
        if (socket.connected) join(room);
      }
      set.add(handler);
      if (!started) {
        started = true;
        socket.connect();
      }
      return () => {
        const current = handlers.get(room);
        if (!current?.delete(handler)) return;
        if (current.size === 0) {
          handlers.delete(room);
          if (socket.connected) leave(room);
        }
      };
    },
    onStatus(fn: (up: boolean) => void) {
      statusListeners.add(fn);
      return () => void statusListeners.delete(fn);
    },
    onReconnect(fn: () => void) {
      reconnectListeners.add(fn);
      return () => void reconnectListeners.delete(fn);
    },
    isConnected: () => socket.connected,
    close: () => void socket.disconnect(),
  };
}

export type LiveClient = ReturnType<typeof createLiveClient>;

let shared: LiveClient | undefined;

/** The page's one client, made on first use. Websocket only: polling as a transport would add requests for nothing. */
export function getLiveClient(): LiveClient {
  shared ??= createLiveClient({
    socket: io(process.env.NEXT_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001", {
      autoConnect: false,
      transports: ["websocket"],
      reconnectionDelayMax: 10_000,
    }) as unknown as LiveSocket,
  });
  return shared;
}
