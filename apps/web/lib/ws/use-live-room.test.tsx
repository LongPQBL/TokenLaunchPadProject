import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveClient, LiveMessage } from "./client";
import { useLiveRoom } from "./use-live-room";

/** A stand-in client: the test decides whether it is connected and when messages arrive. */
function fakeClient() {
  const listeners = new Map<string, Set<(m: LiveMessage) => void>>();
  const statusFns = new Set<(up: boolean) => void>();
  const reconnectFns = new Set<() => void>();
  const state = { connected: false };
  const client = {
    subscribe: vi.fn((room: string, fn: (m: LiveMessage) => void) => {
      if (!listeners.has(room)) listeners.set(room, new Set());
      listeners.get(room)!.add(fn);
      return () => void listeners.get(room)!.delete(fn);
    }),
    onStatus: vi.fn((fn: (up: boolean) => void) => (statusFns.add(fn), () => void statusFns.delete(fn))),
    onReconnect: vi.fn((fn: () => void) => (reconnectFns.add(fn), () => void reconnectFns.delete(fn))),
    isConnected: () => state.connected,
    close: vi.fn(),
  } as unknown as LiveClient;
  return {
    client,
    state,
    message: (room: string, m: LiveMessage) => listeners.get(room)?.forEach((fn) => fn(m)),
    setConnected(up: boolean) {
      state.connected = up;
      statusFns.forEach((fn) => fn(up));
    },
    reconnect: () => reconnectFns.forEach((fn) => fn()),
    listenerCount: (room: string) => listeners.get(room)?.size ?? 0,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (fake = fakeClient(), over: { refetch?: () => Promise<unknown> } = {}) => {
  const onMessage = vi.fn();
  const refetch = vi.fn(over.refetch ?? (async () => {}));
  const hook = renderHook(() => useLiveRoom({ room: "trades", onMessage, refetch, client: fake.client }));
  return { fake, onMessage, refetch, ...hook };
};

describe("useLiveRoom", () => {
  it("passes each message of the room on, and stops listening when the component goes", () => {
    const { fake, onMessage, unmount } = setup();
    fake.message("trades", { type: "trade" });
    expect(onMessage).toHaveBeenCalledWith({ type: "trade" });
    unmount();
    expect(fake.listenerCount("trades")).toBe(0);
  });

  it("falls back to polling every 3 s while the connection is down", async () => {
    const { refetch } = setup(); // not connected
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("skips a poll while websocket ticks are fresh: no point asking for what is already arriving", async () => {
    const fake = fakeClient();
    fake.state.connected = true;
    const { refetch } = setup(fake);
    for (let i = 0; i < 25; i++) {
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      fake.message("trades", { type: "trade" }); // a tick every 2 s, for 50 s: past the slow check-in too
    }
    expect(refetch).not.toHaveBeenCalled();
  });

  it("polls again as soon as the connection drops, without waiting for the ticks to go stale", async () => {
    const fake = fakeClient();
    fake.state.connected = true;
    const { refetch } = setup(fake);
    fake.message("trades", { type: "trade" });
    act(() => fake.setConnected(false));
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("checks in at a slow pace while connected but quiet, in case a message was lost", async () => {
    const fake = fakeClient();
    fake.state.connected = true;
    const { refetch } = setup(fake);
    await act(() => vi.advanceTimersByTimeAsync(29_000));
    expect(refetch).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("refetches at once after a reconnection: what was sent while it was down is never resent", async () => {
    const fake = fakeClient();
    fake.state.connected = true;
    const { refetch } = setup(fake);
    act(() => fake.reconnect());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("never runs two refetches at once: a slow one is waited for", async () => {
    let finish!: () => void;
    const { refetch } = setup(fakeClient(), { refetch: () => new Promise<void>((r) => (finish = r)) });
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(refetch).toHaveBeenCalledTimes(1); // still the first one
    await act(async () => finish());
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after a refetch fails", async () => {
    const { refetch } = setup(fakeClient(), { refetch: async () => Promise.reject(new Error("api down")) });
    await act(() => vi.advanceTimersByTimeAsync(9_000));
    expect(refetch).toHaveBeenCalledTimes(3);
  });

  it("stops polling when the component goes", async () => {
    const { refetch, unmount } = setup();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(refetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); // the interval itself is gone, not merely ignored
  });

  it("uses the newest handlers without re-subscribing every render", () => {
    const fake = fakeClient();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => useLiveRoom({ room: "trades", onMessage: fn, refetch: async () => {}, client: fake.client }), { initialProps: { fn: first } });
    rerender({ fn: second });
    fake.message("trades", { type: "trade" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(fake.client.subscribe).toHaveBeenCalledTimes(1);
  });
});
