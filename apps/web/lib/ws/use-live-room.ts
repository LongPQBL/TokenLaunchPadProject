"use client";

import { useEffect, useRef } from "react";
import { getLiveClient, type LiveClient, type LiveMessage } from "./client";

/** With the connection down, ask for fresh data this often. */
const POLL_MS = 3_000;
/** A message this recent means the socket is working: no need to ask. */
const FRESH_MS = 3_000;
/** Connected but quiet: check in this often anyway, in case a message was lost. */
const SAFETY_MS = 30_000;

interface Options {
  room: string;
  onMessage: (message: LiveMessage) => void;
  /** Fetches the current data again. Called after a reconnect and as the polling fallback. */
  refetch: () => Promise<unknown>;
  client?: LiveClient;
}

/**
 * Listens to one room, and keeps the page right when the websocket cannot be relied on:
 *  - a reconnection refetches at once, because nothing sent while the connection was down is ever resent;
 *  - while the connection is down, it polls every 3 s;
 *  - while it is up and ticks are fresh, it does not poll at all;
 *  - while it is up but quiet, it checks in every 30 s, in case a message was lost.
 * Never two refetches at once, and a failed one does not stop the polling.
 */
export function useLiveRoom({ room, onMessage, refetch, client }: Options) {
  // The latest callbacks, without making the subscription depend on them: a new closure every render must not re-join the room.
  const handler = useRef(onMessage);
  const fetcher = useRef(refetch);
  handler.current = onMessage;
  fetcher.current = refetch;

  useEffect(() => {
    const live = client ?? getLiveClient();
    let lastMessage = 0;
    let lastFetch = Date.now();
    let fetching = false;
    let stopped = false;

    const run = async () => {
      if (fetching || stopped) return;
      fetching = true;
      lastFetch = Date.now();
      try {
        await fetcher.current();
      } catch {
        /* the next poll tries again */
      } finally {
        fetching = false;
      }
    };

    const off = live.subscribe(room, (message) => {
      lastMessage = Date.now();
      handler.current(message);
    });
    const offReconnect = live.onReconnect(() => void run());

    const timer = setInterval(() => {
      const now = Date.now();
      if (live.isConnected()) {
        if (now - lastMessage < FRESH_MS) return;
        if (now - lastFetch < SAFETY_MS) return;
      }
      void run();
    }, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      off();
      offReconnect();
    };
  }, [room, client]);
}
