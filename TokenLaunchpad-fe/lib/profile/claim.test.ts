import { launchpadAbi } from "@vezta/abi";
import { describe, expect, it, vi } from "vitest";
import { claimCreatorFees, type ClaimDeps } from "./claim";

const LAUNCHPAD = "0x00000000000000000000000000000000000000c3";
const WETH = "0x00000000000000000000000000000000000000e5";
const ME = "0x00000000000000000000000000000000000000a1";
const HASH = `0x${"cd".repeat(32)}`;

function deps(over: Partial<ClaimDeps> = {}) {
  const writeContract = vi.fn<(args: unknown) => Promise<`0x${string}`>>(async () => HASH as `0x${string}`);
  const waitForTransactionReceipt = vi.fn<(args: unknown) => Promise<{ status: "success" | "reverted" }>>(async () => ({
    status: "success",
  }));
  const d: ClaimDeps = {
    launchpad: LAUNCHPAD,
    quote: WETH,
    expectedChainId: 11155111,
    chainId: 11155111,
    account: ME,
    walletClient: { writeContract } as never,
    publicClient: { waitForTransactionReceipt } as never,
    ...over,
  };
  return { d, writeContract, waitForTransactionReceipt };
}

describe("claimCreatorFees from a wallet that signs in the browser", () => {
  it("hands the wallet client the account itself, not just its address: an address alone would ask a node to sign", async () => {
    const local = { address: ME, type: "local", signMessage: vi.fn() } as never;
    const { d, writeContract } = deps({ localAccount: local });
    await claimCreatorFees(d, ME);
    expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({ account: local }));
  });
});

describe("claimCreatorFees", () => {
  it("claims for the creator, in the deployment's quote token, and waits for it", async () => {
    const { d, writeContract, waitForTransactionReceipt } = deps();
    expect(await claimCreatorFees(d, ME)).toEqual({ hash: HASH });
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "claimCreatorFees", args: [ME, WETH], account: ME }),
    );
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });

  it("asks the wallet nothing when none is connected or on the wrong network", async () => {
    const a = deps({ account: undefined, walletClient: undefined });
    await expect(claimCreatorFees(a.d, ME)).rejects.toMatchObject({ code: "not_connected" });
    const b = deps({ chainId: 1 });
    await expect(claimCreatorFees(b.d, ME)).rejects.toMatchObject({ code: "wrong_chain" });
    expect(a.writeContract).not.toHaveBeenCalled();
    expect(b.writeContract).not.toHaveBeenCalled();
  });

  it("says so when the transaction was mined and reverted", async () => {
    const { d } = deps({ publicClient: { waitForTransactionReceipt: async () => ({ status: "reverted" }) } as never });
    await expect(claimCreatorFees(d, ME)).rejects.toMatchObject({ code: "reverted" });
  });
});
