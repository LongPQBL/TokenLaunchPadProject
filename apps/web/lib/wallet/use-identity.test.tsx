import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { recoverMessageAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { describe, expect, it, vi } from "vitest";
import { SessionContext, type SessionValue } from "../session/use-session";
import { embeddedConnector, externalConnector, testWallet, TEST_USER } from "../../test/wallet";
import { useIdentity } from "./use-identity";

const trading = privateKeyToAccount(generatePrivateKey());
const signer = vi.hoisted(() => ({ signMessageAsync: vi.fn() }));
vi.mock("wagmi", async (importOriginal) => ({ ...(await importOriginal<typeof import("wagmi")>()), useSignMessage: () => signer }));

const session = (over: Partial<SessionValue> = {}): SessionValue => ({
  status: "ready",
  account: trading,
  main: TEST_USER,
  enable: async () => true,
  ...over,
});

async function identity(value: SessionValue | undefined, o: { embedded?: boolean; connected?: boolean } = {}) {
  const wallet = testWallet([o.embedded ? embeddedConnector(TEST_USER) : externalConnector()]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <wallet.wrapper>{value ? <SessionContext.Provider value={value}>{children}</SessionContext.Provider> : children}</wallet.wrapper>
  );
  const hook = renderHook(() => useIdentity(), { wrapper });
  if (o.connected ?? true) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return hook;
}

describe("useIdentity: an external wallet (MetaMask, Phantom)", () => {
  it("is the trading wallet, once it is open: that is who the person is in this app", async () => {
    const { result } = await identity(session());
    expect(result.current.kind).toBe("external");
    expect(result.current.address).toBe(trading.address);
    expect(result.current.status).toBe("ready");
  });

  it("knows the main wallet it is funded from, which is a different address", async () => {
    const { result } = await identity(session());
    expect(result.current.main?.toLowerCase()).toBe(TEST_USER);
    expect(result.current.address).not.toBe(result.current.main);
  });

  it("signs with the trading wallet's own key, in the browser, asking the main wallet for nothing", async () => {
    signer.signMessageAsync.mockReset();
    const { result } = await identity(session());
    const signature = await result.current.signMessage!("hello");
    expect(await recoverMessageAddress({ message: "hello", signature })).toBe(trading.address);
    expect(signer.signMessageAsync).not.toHaveBeenCalled();
  });

  it("is nobody yet while the trading wallet is opening, and says so", async () => {
    const { result } = await identity(session({ status: "restoring", account: undefined }));
    expect(result.current.address).toBeUndefined();
    expect(result.current.status).toBe("opening");
    expect(result.current.main?.toLowerCase()).toBe(TEST_USER);
    expect(result.current.signMessage).toBeUndefined();
  });

  it("is nobody, and says a signature is needed, when the browser has lost the key or the person declined", async () => {
    const { result } = await identity(session({ status: "needs-signature", account: undefined }));
    expect(result.current.address).toBeUndefined();
    expect(result.current.status).toBe("needs-signature");
  });

  it("is nobody, and says so, when the main wallet signed differently than before", async () => {
    const { result } = await identity(session({ status: "mismatch", account: undefined }));
    expect(result.current.address).toBeUndefined();
    expect(result.current.status).toBe("mismatch");
  });

  it("is never the main wallet, whatever the session says: a wallet that is not the trading wallet does not stand in for it", async () => {
    for (const status of ["restoring", "needs-signature", "mismatch"] as const) {
      const { result, unmount } = await identity(session({ status, account: undefined }));
      expect(result.current.address, status).toBeUndefined();
      unmount();
    }
  });
});

describe("useIdentity: a wallet that signs by itself (Google, email)", () => {
  it("is the wallet itself: it IS the trading wallet, and signs through its own provider", async () => {
    signer.signMessageAsync.mockReset().mockResolvedValue("0xsigned");
    const { result } = await identity(session({ status: "none", account: undefined, main: undefined }), { embedded: true });
    expect(result.current.kind).toBe("embedded");
    expect(result.current.address?.toLowerCase()).toBe(TEST_USER);
    expect(result.current.status).toBe("ready");
    expect(await result.current.signMessage!("hello")).toBe("0xsigned");
    expect(signer.signMessageAsync).toHaveBeenCalledWith({ message: "hello" });
  });
});

describe("useIdentity: nobody connected", () => {
  it("is nobody", async () => {
    const { result } = await identity(undefined, { connected: false });
    expect(result.current).toMatchObject({ kind: "none", address: undefined, main: undefined, status: "none", signMessage: undefined });
  });
});
