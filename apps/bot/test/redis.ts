import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { Redis } from "ioredis";

/**
 * A Redis of the test's own, on a free port: never the maintainer's on 6379. Data is not saved to disk, and it is stopped
 * when the test says so. Redis is a hard requirement of these tests; without redis-server they fail rather than skip.
 */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export interface TestRedis {
  port: number;
  url: string;
  stop(): Promise<void>;
  /** Starts it again on the same port (after stop()), to test reconnection. */
  start(): Promise<void>;
}

export async function startRedis(port?: number): Promise<TestRedis> {
  const chosen = port ?? (await freePort());
  let child: ChildProcess | undefined;

  async function start() {
    child = spawn("redis-server", ["--port", String(chosen), "--bind", "127.0.0.1", "--save", "", "--appendonly", "no", "--loglevel", "warning"], { stdio: "ignore" });
    // ready when it answers
    for (let i = 0; i < 100; i++) {
      const probe = new Redis({ port: chosen, host: "127.0.0.1", lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
      probe.on("error", () => {});
      try {
        await probe.connect();
        await probe.ping();
        probe.disconnect();
        return;
      } catch {
        probe.disconnect();
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error("redis-server did not start");
  }

  async function stop() {
    if (!child) return;
    const dying = child;
    child = undefined;
    await new Promise<void>((resolve) => {
      dying.once("exit", () => resolve());
      dying.kill("SIGTERM");
    });
  }

  await start();
  return { port: chosen, url: `redis://127.0.0.1:${chosen}`, stop, start };
}
