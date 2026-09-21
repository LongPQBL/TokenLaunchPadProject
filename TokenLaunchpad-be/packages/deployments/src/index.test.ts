import { describe, expect, it } from "vitest";
import { loadDeployment } from "./index.js";

describe("loadDeployment", () => {
  it("reads packages/deployments/<name>.json and returns the fields the app relies on", () => {
    const d = loadDeployment("example");
    expect(d.chainId).toBe(11155111);
    for (const key of ["launchpad", "factory", "weth", "uniswapV2Factory", "uniswapV2Router", "owner", "feeRecipient"] as const) {
      expect(d[key], key).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
    expect(typeof d.deployBlock).toBe("number");
  });

  it("names the missing file and the fix, rather than leaking a bare ENOENT", () => {
    expect(() => loadDeployment("does-not-exist")).toThrow(/does-not-exist\.json/);
    expect(() => loadDeployment("does-not-exist")).toThrow(/local-chain/);
  });

  it("defaults to the DEPLOYMENT environment variable", () => {
    process.env.DEPLOYMENT = "example";
    try {
      expect(loadDeployment().chainId).toBe(11155111);
    } finally {
      delete process.env.DEPLOYMENT;
    }
  });
});
