import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_DEPLOYMENT } from "../../test/wallet";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@privy-io/react-auth");
  vi.doUnmock("@privy-io/wagmi");
  vi.restoreAllMocks();
});

describe("WalletProvider", { timeout: 30_000 }, () => {
  it("renders exactly as before when there is no Privy App ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    const { WalletProvider } = await import("./provider");
    render(
      <WalletProvider>
        <p>hi</p>
      </WalletProvider>,
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  // Review Focus 1: the optional layer failing to start must never become a blank page.
  it("still renders the app, on the plain wallet layer, when the Privy layer throws while mounting", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "cmuap9z3s01wc0cl9aqwaf2ei");
    vi.doMock("@privy-io/react-auth", () => ({
      PrivyProvider: () => {
        throw new Error("Privy could not start");
      },
      usePrivy: () => ({}),
    }));
    vi.doMock("@privy-io/wagmi", async () => {
      const wagmi = await import("wagmi");
      return { createConfig: wagmi.createConfig, WagmiProvider: wagmi.WagmiProvider };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { WalletProvider } = await import("./provider");
    render(
      <WalletProvider>
        <p>still here</p>
      </WalletProvider>,
    );
    // The Privy layer is loaded on demand: its libraries are large, and the first load can take a few seconds.
    expect(await screen.findByText("still here", {}, { timeout: 20_000 })).toBeInTheDocument();
  });

  it("puts the Privy layer around the app when there is an App ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "cmuap9z3s01wc0cl9aqwaf2ei");
    const seen: string[] = [];
    vi.doMock("@privy-io/react-auth", () => ({
      PrivyProvider: ({ appId, children }: { appId: string; children: React.ReactNode }) => {
        seen.push(appId);
        return <div data-testid="privy">{children}</div>;
      },
      usePrivy: () => ({}),
    }));
    // The real Privy wagmi bridge needs the real Privy context; here it stands in for it with plain wagmi.
    vi.doMock("@privy-io/wagmi", async () => {
      const wagmi = await import("wagmi");
      return { createConfig: wagmi.createConfig, WagmiProvider: wagmi.WagmiProvider };
    });
    const { WalletProvider } = await import("./provider");
    render(
      <WalletProvider>
        <p>inside</p>
      </WalletProvider>,
    );
    expect(await screen.findByTestId("privy", {}, { timeout: 20_000 })).toContainElement(screen.getByText("inside"));
    expect(seen).toEqual(["cmuap9z3s01wc0cl9aqwaf2ei"]);
  });
});
