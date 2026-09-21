import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLoop } from "./loop.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startLoop", () => {
  it("runs the task on every tick", async () => {
    const task = vi.fn(async () => {});
    const loop = startLoop(task, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    loop.stop();
    expect(task).toHaveBeenCalledTimes(3);
  });

  // A slow pass must not be joined by a second one: the passes fetch from the network and write rows.
  it("never runs two passes at once, skipping ticks while one is still in flight", async () => {
    let running = 0;
    let maxRunning = 0;
    const task = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 2500));
      running--;
    });
    const loop = startLoop(task, 1000);
    await vi.advanceTimersByTimeAsync(10_000);
    loop.stop();
    expect(maxRunning).toBe(1);
    expect(task.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps going after the task throws, and reports the error", async () => {
    const onError = vi.fn();
    const task = vi.fn(async () => {
      throw new Error("boom");
    });
    const loop = startLoop(task, 1000, onError);
    await vi.advanceTimersByTimeAsync(3500);
    loop.stop();
    expect(task).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it("stops when asked and does not fire again", async () => {
    const task = vi.fn(async () => {});
    const loop = startLoop(task, 1000);
    await vi.advanceTimersByTimeAsync(1500);
    loop.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
