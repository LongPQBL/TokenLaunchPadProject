import { Redis } from "ioredis";

/**
 * Publishing to Redis pub/sub. Realtime is best-effort: a message that cannot be sent is dropped (the caller hears about
 * it), never queued. With the offline queue on, a Redis outage would pile up messages in memory until the process died,
 * and then replay a flood of stale trades when it came back. Instead a publish while Redis is down fails at once, and
 * the connection heals itself in the background.
 */
export function createRedisPublisher(url: string) {
  const redis = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    // Keep trying to reconnect, gently: 200 ms growing to 5 s.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  // An outage is reported by the failed publish. Without a listener, ioredis would log every reconnect attempt as unhandled.
  redis.on("error", () => {});

  /** Waits briefly for the connection (right after start-up it is not up yet), and gives up if it does not come. */
  const ready = () =>
    redis.status === "ready"
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            redis.off("ready", onReady);
            reject(new Error("redis is not connected"));
          }, 500);
          const onReady = () => {
            clearTimeout(timer);
            resolve();
          };
          redis.once("ready", onReady);
        });

  return {
    publish: async (channel: string, message: string) => {
      await ready();
      return redis.publish(channel, message);
    },
    close: async () => {
      redis.disconnect();
    },
  };
}
