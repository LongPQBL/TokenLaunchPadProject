import { launchpadAbi } from "@vezta/abi";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createMigrator, MIGRATE_GAS, MIN_MIGRATIONS_OF_GAS } from "./migrate";

const LAUNCHPAD = "0x00000000000000000000000000000000000000c3" as Address;
const T1 = "0x00000000000000000000000000000000000000b1" as Address;
const T2 = "0x00000000000000000000000000000000000000b2" as Address;
const T3 = "0x00000000000000000000000000000000000000b3" as Address;
const BOT = "0x00000000000000000000000000000000000000d1" as Address;
const HASH = `0x${"ab".repeat(32)}` as const;

const revert = (errorName: "AlreadyMigrated" | "NotCompleted" | "CurveNotFound") => {
  const data = encodeErrorResult({ abi: launchpadAbi, errorName });
  return new BaseError("reverted", { cause: new ContractFunctionRevertedError({ abi: launchpadAbi, data, functionName: "migrate" }) });
};

interface CurveState {
  complete: boolean;
  migrated: boolean;
}

function setup(opts: { curves?: Record<string, CurveState>; logs?: { block: bigint; token: Address }[]; head?: bigint; balance?: bigint; gasPrice?: bigint } = {}) {
  const curves = new Map(Object.entries(opts.curves ?? {}).map(([t, c]) => [t.toLowerCase(), { ...c }]));
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const logsAsked: { fromBlock: bigint; toBlock: bigint }[] = [];

  const publicClient = {
    readContract: vi.fn(async ({ args }: { functionName: string; args: [Address] }) => {
      const c = curves.get(args[0].toLowerCase());
      if (!c) throw revert("CurveNotFound");
      return { complete: c.complete, migrated: c.migrated };
    }),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "success" })),
    getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      logsAsked.push({ fromBlock, toBlock });
      return (opts.logs ?? []).filter((l) => l.block >= fromBlock && l.block <= toBlock).map((l) => ({ args: { mint: l.token }, blockNumber: l.block }));
    }),
    getBlockNumber: vi.fn(async () => opts.head ?? 100n),
    getBalance: vi.fn(async () => opts.balance ?? 10n ** 20n),
    getGasPrice: vi.fn(async () => opts.gasPrice ?? 1_000_000_000n),
  };
  const walletClient = {
    writeContract: vi.fn(async ({ args }: { args: [Address] }) => {
      const c = curves.get(args[0].toLowerCase());
      if (c) c.migrated = true;
      return HASH;
    }),
  };
  const migrator = createMigrator({
    publicClient: publicClient as never,
    walletClient: walletClient as never,
    account: BOT,
    launchpad: LAUNCHPAD,
    deployBlock: 10n,
    sleep: async (ms) => void sleeps.push(ms),
    warn: (m) => warnings.push(m),
    log: () => {},
  });
  return { migrator, publicClient, walletClient, curves, sleeps, warnings, logsAsked };
}

describe("migrateIfNeeded", () => {
  it("migrates a completed curve", async () => {
    const { migrator, walletClient, publicClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    expect(await migrator.migrateIfNeeded(T1)).toBe("migrated");
    expect(walletClient.writeContract).toHaveBeenCalledWith(expect.objectContaining({ address: LAUNCHPAD, functionName: "migrate", args: [T1], account: BOT }));
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledOnce();
  });

  it("checks the curve first, so an event redelivered after it was migrated costs nothing", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: true, migrated: true } } });
    expect(await migrator.migrateIfNeeded(T1)).toBe("already");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("does not send a transaction for a curve that is not complete", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: false, migrated: false } } });
    expect(await migrator.migrateIfNeeded(T1)).toBe("not-ready");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("treats AlreadyMigrated as success: another caller won the race", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    walletClient.writeContract.mockRejectedValueOnce(revert("AlreadyMigrated"));
    expect(await migrator.migrateIfNeeded(T1)).toBe("already");
  });

  it("does NOT retry NotCompleted: that is a bug or a reorg, not a transient failure", async () => {
    const { migrator, walletClient, sleeps } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    walletClient.writeContract.mockRejectedValue(revert("NotCompleted"));
    expect(await migrator.migrateIfNeeded(T1)).toBe("not-ready");
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
    expect(sleeps).toEqual([]);
  });

  it("says not-ready for an address the launchpad does not know", async () => {
    const { migrator, walletClient } = setup({ curves: {} });
    expect(await migrator.migrateIfNeeded(T1)).toBe("not-ready");
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("retries a transient RPC failure with growing pauses, then succeeds", async () => {
    const { migrator, walletClient, sleeps } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    walletClient.writeContract.mockRejectedValueOnce(new Error("HTTP request failed")).mockRejectedValueOnce(new Error("timeout"));
    expect(await migrator.migrateIfNeeded(T1)).toBe("migrated");
    expect(walletClient.writeContract).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("gives up after a few tries and reports the failure instead of looping for ever", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    walletClient.writeContract.mockRejectedValue(new Error("HTTP request failed"));
    await expect(migrator.migrateIfNeeded(T1)).rejects.toThrow("HTTP request failed");
    expect(walletClient.writeContract).toHaveBeenCalledTimes(4);
  });

  it("re-checks the curve on each retry: a transaction that failed on the wire may still have landed", async () => {
    const { migrator, walletClient, curves } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    walletClient.writeContract.mockImplementationOnce(async () => {
      curves.get(T1.toLowerCase())!.migrated = true; // it did go through, though the reply was lost
      throw new Error("connection reset");
    });
    expect(await migrator.migrateIfNeeded(T1)).toBe("already");
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
  });
});

describe("handleComplete", () => {
  it("migrates once when the same Complete event is delivered twice, at once or later (a reorg redelivers)", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    const [a, b] = await Promise.all([migrator.handleComplete(T1), migrator.handleComplete(T1)]);
    await migrator.handleComplete(T1);
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
    expect([a, b]).toContain("migrated");
  });

  it("does not even read the curve again for an event it has already dealt with", async () => {
    const { migrator, publicClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    await migrator.handleComplete(T1);
    const reads = publicClient.readContract.mock.calls.length;
    await migrator.handleComplete(T1);
    expect(publicClient.readContract.mock.calls.length).toBe(reads);
  });

  it("does not remember 'not ready' as done: the curve may complete a moment later and the event is real", async () => {
    const { migrator, walletClient, curves } = setup({ curves: { [T1]: { complete: false, migrated: false } } });
    expect(await migrator.handleComplete(T1)).toBe("not-ready");
    curves.get(T1.toLowerCase())!.complete = true;
    expect(await migrator.handleComplete(T1)).toBe("migrated");
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
  });

  it("treats the token's address case-insensitively", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    await migrator.handleComplete(T1);
    await migrator.handleComplete(T1.toUpperCase().replace("0X", "0x") as Address);
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
  });

  it("tries again on a later event after a failure: a failure is not remembered as done", async () => {
    const { migrator, walletClient } = setup({ curves: { [T1]: { complete: true, migrated: false } } });
    walletClient.writeContract.mockRejectedValue(new Error("down"));
    await expect(migrator.handleComplete(T1)).rejects.toThrow();
    walletClient.writeContract.mockResolvedValue(HASH);
    expect(await migrator.handleComplete(T1)).toBe("migrated");
  });

  it("keeps its memory bounded", async () => {
    const curves: Record<string, CurveState> = {};
    for (let i = 0; i < 12_000; i++) curves[`0x${i.toString(16).padStart(40, "0")}`] = { complete: true, migrated: true };
    const { migrator } = setup({ curves });
    for (const t of Object.keys(curves)) await migrator.handleComplete(t as Address);
    expect(migrator.rememberedCount()).toBeLessThanOrEqual(10_000);
  });
});

describe("catchUp", () => {
  it("migrates everything still pending from the given block on start-up, and skips what is already migrated", async () => {
    const { migrator, walletClient } = setup({
      head: 50n,
      logs: [{ block: 12n, token: T1 }, { block: 30n, token: T2 }, { block: 40n, token: T3 }],
      curves: { [T1]: { complete: true, migrated: true }, [T2]: { complete: true, migrated: false }, [T3]: { complete: true, migrated: false } },
    });
    const migrated = await migrator.catchUp(10n);
    expect(migrated.map((t) => t.toLowerCase()).sort()).toEqual([T2, T3]);
    expect(walletClient.writeContract).toHaveBeenCalledTimes(2);
  });

  it("includes the very last block: a curve that completed in the newest block is not missed", async () => {
    const { migrator, walletClient } = setup({ head: 10n, logs: [{ block: 10n, token: T1 }], curves: { [T1]: { complete: true, migrated: false } } });
    await migrator.catchUp(10n);
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
  });

  it("reads the logs in bounded ranges, so a long history is not one enormous request", async () => {
    const { migrator, logsAsked } = setup({ head: 25_000n, logs: [] });
    await migrator.catchUp(10n);
    expect(logsAsked.length).toBeGreaterThan(1);
    for (const r of logsAsked) expect(r.toBlock - r.fromBlock).toBeLessThanOrEqual(5_000n);
    expect(logsAsked[0]!.fromBlock).toBe(10n);
    expect(logsAsked.at(-1)!.toBlock).toBe(25_000n);
    // no gap and no overlap between ranges
    for (let i = 1; i < logsAsked.length; i++) expect(logsAsked[i]!.fromBlock).toBe(logsAsked[i - 1]!.toBlock + 1n);
  });

  it("carries on with the others when one token fails, and still reports what it did", async () => {
    const { migrator, walletClient } = setup({
      head: 50n,
      logs: [{ block: 12n, token: T1 }, { block: 13n, token: T2 }],
      curves: { [T1]: { complete: true, migrated: false }, [T2]: { complete: true, migrated: false } },
    });
    walletClient.writeContract.mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down")).mockRejectedValueOnce(new Error("down"));
    const migrated = await migrator.catchUp(10n);
    expect(migrated.map((t) => t.toLowerCase())).toEqual([T2]);
  });

  it("does not migrate the same token twice when it is listed twice", async () => {
    const { migrator, walletClient } = setup({ head: 50n, logs: [{ block: 12n, token: T1 }, { block: 13n, token: T1 }], curves: { [T1]: { complete: true, migrated: false } } });
    await migrator.catchUp(10n);
    expect(walletClient.writeContract).toHaveBeenCalledOnce();
  });
});

describe("checkBalance", () => {
  it("warns when the wallet cannot pay for fifty more migrations", async () => {
    const gasPrice = 2_000_000_000n;
    const enough = MIGRATE_GAS * gasPrice * BigInt(MIN_MIGRATIONS_OF_GAS);
    const low = setup({ balance: enough - 1n, gasPrice });
    await low.migrator.checkBalance();
    expect(low.warnings).toHaveLength(1);
    expect(low.warnings[0]).toMatch(/50 migrations/);
    expect(low.warnings[0]).toContain(BOT);

    const fine = setup({ balance: enough, gasPrice });
    await fine.migrator.checkBalance();
    expect(fine.warnings).toEqual([]);
  });

  it("does not stop the bot when it cannot read the balance, but says so", async () => {
    const s = setup();
    s.publicClient.getBalance.mockRejectedValueOnce(new Error("down"));
    await expect(s.migrator.checkBalance()).resolves.toBeUndefined();
    expect(s.warnings.length).toBe(1);
  });

  it("uses the constants the reference gives: about 2.7M gas per migration, fifty of them", () => {
    expect(MIGRATE_GAS).toBe(3_000_000n);
    expect(MIN_MIGRATIONS_OF_GAS).toBe(50);
  });
});
