import { mock } from "wagmi/connectors";
import { describe, expect, it } from "vitest";
import { createWagmiConfig } from "./config";

describe("createWagmiConfig", () => {
  it("is configured for the one chain the app is deployed on, and reads through the given RPC", () => {
    const config = createWagmiConfig({ chainId: 11155111, rpcUrl: "http://127.0.0.1:8555" });
    expect(config.chains.map((c) => c.id)).toEqual([11155111]);
  });

  it("refuses a chain the app has no configuration for", () => {
    expect(() => createWagmiConfig({ chainId: 424242 })).toThrow(/chain 424242/);
  });

  it("uses the connectors it is given instead of the defaults, so a test can bring its own wallet", () => {
    const connector = mock({ accounts: ["0x00000000000000000000000000000000000000a1"] });
    const config = createWagmiConfig({ chainId: 11155111, connectors: [connector] });
    expect(config.connectors.map((c) => c.type)).toContain("mock");
  });

  it("adds WalletConnect only when a project id is configured", () => {
    const without = createWagmiConfig({ chainId: 11155111 });
    const withId = createWagmiConfig({ chainId: 11155111, walletConnectProjectId: "abc123" });
    expect(without.connectors.some((c) => c.id === "walletConnect")).toBe(false);
    expect(withId.connectors.some((c) => c.id === "walletConnect")).toBe(true);
  });
});
