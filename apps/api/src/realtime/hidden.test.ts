import { afterEach, describe, expect, it, vi } from "vitest";
import { createHiddenTokens } from "./hidden.js";

afterEach(() => vi.useRealTimers());

describe("the list of hidden tokens the realtime server checks", () => {
  it("is empty until the first load, then holds what was loaded", async () => {
    const list = createHiddenTokens({ load: async () => ["sepolia:0xaa"], everyMs: 1_000 });
    expect(list.get().size).toBe(0);
    await list.refresh();
    expect([...list.get()]).toEqual(["sepolia:0xaa"]);
    list.stop();
  });

  it("is refreshed on its own, so a token hidden later is picked up and one unhidden is let go", async () => {
    vi.useFakeTimers();
    let current = ["sepolia:0xaa"];
    const list = createHiddenTokens({ load: async () => current, everyMs: 1_000 });
    await list.refresh();
    current = ["sepolia:0xbb"];
    await vi.advanceTimersByTimeAsync(1_000);
    expect([...list.get()]).toEqual(["sepolia:0xbb"]);
    list.stop();
  });

  it("keeps the last list when a load fails, and says so: a database blip must not let hidden tokens through", async () => {
    const errors: unknown[] = [];
    let fail = false;
    const list = createHiddenTokens({
      load: async () => {
        if (fail) throw new Error("db down");
        return ["sepolia:0xaa"];
      },
      everyMs: 1_000,
      onError: (e) => errors.push(e),
    });
    await list.refresh();
    fail = true;
    await list.refresh();
    expect([...list.get()]).toEqual(["sepolia:0xaa"]);
    expect(errors).toHaveLength(1);
    list.stop();
  });

  it("stops refreshing when stopped", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => [] as string[]);
    const list = createHiddenTokens({ load, everyMs: 1_000 });
    list.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(load).not.toHaveBeenCalled();
  });
});
