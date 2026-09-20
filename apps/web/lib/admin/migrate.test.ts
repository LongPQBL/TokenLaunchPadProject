import { launchpadAbi } from "@vezta/abi";
import { describe, expect, it, vi } from "vitest";
import { TradeError } from "../wallet/types";
import { migrateToken, type MigrateDeps } from "./migrate";

const LAUNCHPAD = "0x00000000000000000000000000000000000000c3";
const TOKEN = "0x00000000000000000000000000000000000000b2";
const ME = "0x00000000000000000000000000000000000000a1";
const HASH = `0x${"ab".repeat(32)}`;

function deps(over: Partial<MigrateDeps> = {}) {
  const writeContract = vi.fn<(args: unknown) => Promise<`0x${string}`>>(async () => HASH as `0x${string}`);
  const waitForTransactionReceipt = vi.fn<(args: unknown) => Promise<{ status: "success" | "reverted" }>>(async () => ({
    status: "success",
  }));
  const d: MigrateDeps = {
    launchpad: LAUNCHPAD,
    expectedChainId: 11155111,
    chainId: 11155111,
    account: ME,
    walletClient: { writeContract } as never,
    publicClient: { waitForTransactionReceipt } as never,
    ...over,
  };
  return { d, writeContract, waitForTransactionReceipt };
}

describe("migrateToken", () => {
  it("calls migrate(token) on the launchpad from the admin's own wallet, and waits for it", async () => {
    const { d, writeContract, waitForTransactionReceipt } = deps();
    expect(await migrateToken(d, TOKEN)).toEqual({ hash: HASH });
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: LAUNCHPAD, abi: launchpadAbi, functionName: "migrate", args: [TOKEN], account: ME }),
    );
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
  });

  it("asks the wallet nothing when none is connected", async () => {
    const { d, writeContract } = deps({ account: undefined, walletClient: undefined });
    await expect(migrateToken(d, TOKEN)).rejects.toMatchObject({ code: "not_connected" });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("asks the wallet nothing on the wrong network", async () => {
    const { d, writeContract } = deps({ chainId: 1 });
    await expect(migrateToken(d, TOKEN)).rejects.toMatchObject({ code: "wrong_chain" });
    expect(writeContract).not.toHaveBeenCalled();
  });

  it("says so when the transaction was mined and reverted (another wallet may have got there first)", async () => {
    const { d } = deps({ publicClient: { waitForTransactionReceipt: async () => ({ status: "reverted" }) } as never });
    const err = await migrateToken(d, TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TradeError);
    expect(err).toMatchObject({ code: "reverted" });
  });

  it("lets a refusal in the wallet through as it is, for the caller to treat as a person's choice", async () => {
    const rejection = Object.assign(new Error("denied"), { code: 4001 });
    const { d } = deps({ walletClient: { writeContract: async () => Promise.reject(rejection) } as never });
    await expect(migrateToken(d, TOKEN)).rejects.toBe(rejection);
  });
});
