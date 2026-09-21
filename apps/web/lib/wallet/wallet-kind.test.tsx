import { act, renderHook, waitFor } from "@testing-library/react";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { describe, expect, it } from "vitest";
import { TEST_USER, testWallet } from "../../test/wallet";
import { EMBEDDED_CONNECTOR_ID, isEmbeddedConnector, useWalletKind } from "./wallet-kind";

/** A mock wallet that calls itself something else, the way Privy's embedded wallet announces its own id. */
const named = (id: string) => (config: Parameters<ReturnType<typeof mock>>[0]) => ({ ...mock({ accounts: [TEST_USER] })(config), id });

describe("isEmbeddedConnector", () => {
  it("knows the Privy embedded wallet by its connector id, and nothing else", () => {
    expect(EMBEDDED_CONNECTOR_ID).toBe("io.privy.wallet");
    expect(isEmbeddedConnector({ id: "io.privy.wallet" })).toBe(true);
    for (const id of ["io.metamask", "injected", "walletConnect", "io.privy.smart", "io.privy.wallet.evil", "IO.PRIVY.WALLET", ""]) {
      expect(isEmbeddedConnector({ id }), id).toBe(false);
    }
    expect(isEmbeddedConnector(undefined)).toBe(false);
  });
});

describe("useWalletKind", () => {
  async function kindWith(id: string | undefined) {
    const wallet = testWallet(id ? [named(id)] : []);
    const hook = renderHook(() => useWalletKind(), { wrapper: wallet.wrapper });
    if (id) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
    return hook;
  }

  it("is none while no wallet is connected", async () => {
    const { result } = await kindWith(undefined);
    expect(result.current).toBe("none");
  });

  it("is external for a wallet that is not Privy's embedded one", async () => {
    const { result } = await kindWith("io.metamask");
    await waitFor(() => expect(result.current).toBe("external"));
  });

  it("is embedded for Privy's embedded wallet", async () => {
    const { result } = await kindWith("io.privy.wallet");
    await waitFor(() => expect(result.current).toBe("embedded"));
  });

  it("is external for a look-alike id, so a hostile wallet cannot claim to be the embedded one", async () => {
    const { result } = await kindWith("io.privy.wallet.evil");
    await waitFor(() => expect(result.current).toBe("external"));
  });
});
