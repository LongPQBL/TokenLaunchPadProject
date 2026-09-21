import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const load = async () => (await import("./next.config")).default;

// A build writes over the folder the running server reads its files from. So two things that build the app on one machine (the demo, and the
// browser tests) must not share one folder, or the running one serves pages that point at files the other has just replaced (404 on every
// script, "This page couldn't load").
describe("the folder the app is built into", () => {
  it("is .next, as ever, unless it is told otherwise", async () => {
    vi.stubEnv("NEXT_DIST_DIR", "");
    expect((await load()).distDir).toBe(".next");
  });

  it("is the folder named by NEXT_DIST_DIR, so a second build can live beside the first", async () => {
    vi.stubEnv("NEXT_DIST_DIR", ".next-demo");
    expect((await load()).distDir).toBe(".next-demo");
  });
});
