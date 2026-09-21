import { describe, expect, it } from "vitest";
import { PRIVY_LOGIN_METHODS, privyAppId, privyConfig } from "./privy";

describe("privyAppId", () => {
  it("is nothing when unset, empty or blank: Privy is then not part of the app", () => {
    for (const v of [undefined, "", "   "]) expect(privyAppId(v)).toBeUndefined();
  });

  it("trims what is set", () => {
    expect(privyAppId("  cmuap9z3s01wc0cl9aqwaf2ei ")).toBe("cmuap9z3s01wc0cl9aqwaf2ei");
  });
});

describe("privyConfig", () => {
  it("offers email, Google and wallets, and asks Privy for no confirmation screen (spec 7.3: zero prompts)", () => {
    const c = privyConfig(11155111);
    expect(c.loginMethods).toEqual([...PRIVY_LOGIN_METHODS]);
    expect(c.loginMethods).toEqual(["email", "google", "wallet"]);
    expect(c.embeddedWallets?.showWalletUIs).toBe(false);
    expect(c.embeddedWallets?.ethereum?.createOnLogin).toBe("users-without-wallets");
  });

  it("shows Email, Google and ONE wallet option on the first screen, with MetaMask and Phantom listed together behind it", () => {
    const c = privyConfig(11155111);
    // Not ordered by us: the first screen is Privy's own (email, Google, "Continue with a wallet"), and the wallets are one screen in.
    expect(c.loginMethodsAndOrder).toBeUndefined();
    expect(c.loginMethods).toEqual(["email", "google", "wallet"]);
    expect(c.appearance?.walletList).toEqual(["metamask", "phantom", "detected_ethereum_wallets"]);
  });

  it("is set up for the deployment's chain only", () => {
    const c = privyConfig(11155111);
    expect(c.defaultChain?.id).toBe(11155111);
    expect(c.supportedChains?.map((x) => x.id)).toEqual([11155111]);
  });

  it("refuses a chain it has no configuration for", () => {
    expect(() => privyConfig(1)).toThrow(/No Privy configuration/);
  });

  it("uses no server-side Privy feature: nothing that delegates signing to a server", () => {
    expect(JSON.stringify(privyConfig(11155111))).not.toMatch(/delegat|authorization|secret/i);
  });
});
