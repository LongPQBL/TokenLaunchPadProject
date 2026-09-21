import { vi } from "vitest";
import type { LiveClient, LiveMessage } from "@/lib/ws/client";

/** A stand-in for the live connection: the test decides when it is up and what arrives. */
export function fakeLiveClient() {
  const listeners = new Map<string, Set<(m: LiveMessage) => void>>();
  const reconnect = new Set<() => void>();
  const state = { connected: true };
  const client = {
    subscribe: vi.fn((room: string, fn: (m: LiveMessage) => void) => {
      if (!listeners.has(room)) listeners.set(room, new Set());
      listeners.get(room)!.add(fn);
      return () => void listeners.get(room)!.delete(fn);
    }),
    onStatus: () => () => {},
    onReconnect: (fn: () => void) => (reconnect.add(fn), () => void reconnect.delete(fn)),
    isConnected: () => state.connected,
    close: () => {},
  } as unknown as LiveClient;
  return {
    client,
    state,
    message: (room: string, m: LiveMessage) => listeners.get(room)?.forEach((fn) => fn(m)),
    reconnect: () => reconnect.forEach((fn) => fn()),
    rooms: () => [...listeners.entries()].filter(([, set]) => set.size > 0).map(([room]) => room),
  };
}
