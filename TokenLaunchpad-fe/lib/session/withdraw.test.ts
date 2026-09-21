import { createPublicClient, custom, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";
import { ledgerNode } from "../../test/ledger-node";
import { WithdrawError, withdrawAll } from "./withdraw";

const MAIN = "0x00000000000000000000000000000000000000a1" as Address;
const T1 = "0x00000000000000000000000000000000000000b1" as Address;
const T2 = "0x00000000000000000000000000000000000000b2" as Address;
const T3 = "0x00000000000000000000000000000000000000b3" as Address;
const T4 = "0x00000000000000000000000000000000000000b4" as Address;
const E18 = 10n ** 18n;

function setup(o: { eth?: bigint; tokens?: Record<string, bigint>; failing?: string[] } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const node = ledgerNode({
    eth: { [account.address]: o.eth ?? 5n * 10n ** 17n },
    tokens: Object.fromEntries(Object.entries(o.tokens ?? { [T1]: 10n * E18, [T2]: 20n * E18, [T3]: 30n * E18 }).map(([t, v]) => [t, { [account.address]: v }])),
    failing: o.failing,
  });
  const publicClient = createPublicClient({ chain: sepolia, transport: custom({ request: node.request }, { retryCount: 0 }) });
  const run = (candidateTokens: Address[], to: Address = MAIN, connectedMain: Address = MAIN) =>
    withdrawAll({ account, to, connectedMain, publicClient, candidateTokens });
  return { account, node, run };
}

describe("withdrawAll", () => {
  it("sends every token that has a balance, including ones no list showed", async () => {
    const { account, node, run } = setup();
    const result = await run([T1, T2, T3]);
    expect(result.tokens).toBe(3);
    for (const [t, v] of [[T1, 10n], [T2, 20n], [T3, 30n]] as const) {
      expect(node.tokenOf(t, MAIN)).toBe(v * E18);
      expect(node.tokenOf(t, account.address)).toBe(0n);
    }
  });

  it("asks the chain for each balance and skips a token that turns out to hold nothing: no transaction, no fee", async () => {
    const { node, run } = setup({ tokens: { [T1]: 10n * E18 } });
    const result = await run([T1, T4]); // T4 was in the list but the wallet holds none of it
    expect(result.tokens).toBe(1);
    expect(node.sent.filter((s) => s.kind === "token")).toHaveLength(1);
  });

  it("does not send the same token twice when it is listed twice", async () => {
    const { node, run } = setup({ tokens: { [T1]: 10n * E18 } });
    await run([T1, T1.toUpperCase().replace("0X", "0x") as Address]);
    expect(node.sent.filter((s) => s.kind === "token")).toHaveLength(1);
  });

  // Sending the ETH first would leave nothing to pay the token transfers' gas with, and strand every token.
  it("sends the ETH LAST", async () => {
    const { node, run } = setup();
    await run([T1, T2, T3]);
    expect(node.sent.map((s) => s.kind)).toEqual(["token", "token", "token", "eth"]);
  });

  it("leaves nothing behind: no ETH and no tokens", async () => {
    const { account, node, run } = setup();
    const result = await run([T1, T2, T3]);
    expect(node.ethOf(account.address)).toBe(0n);
    for (const t of [T1, T2, T3]) expect(node.tokenOf(t, account.address)).toBe(0n);
    expect(result.ethSent).toBe(node.ethOf(MAIN));
    expect(result.ethSent).toBeGreaterThan(0n);
    expect(result.failed).toEqual([]);
  });

  it("is safe to run twice: the second run finds nothing and sends nothing", async () => {
    const { node, run } = setup();
    await run([T1, T2, T3]);
    const before = node.sent.length;
    const again = await run([T1, T2, T3]);
    expect(again).toMatchObject({ tokens: 0, ethSent: 0n, failed: [] });
    expect(node.sent.length).toBe(before);
  });

  it("keeps going when one token cannot be sent, and says exactly which", async () => {
    const { account, node, run } = setup({ failing: [T2] });
    const result = await run([T1, T2, T3]);
    expect(result.tokens).toBe(2);
    expect(result.failed).toEqual([{ token: T2, reason: "transfer_failed" }]);
    expect(node.tokenOf(T1, MAIN)).toBe(10n * E18);
    expect(node.tokenOf(T3, MAIN)).toBe(30n * E18);
    expect(node.tokenOf(T2, account.address)).toBe(20n * E18); // still there, still recoverable
  });

  it("KEEPS the ETH when a token could not be sent, so there is still gas to try again", async () => {
    const { account, node, run } = setup({ failing: [T2] });
    const result = await run([T1, T2, T3]);
    expect(result.ethSent).toBe(0n);
    expect(result.ethKept).toBe("token_failures");
    expect(node.ethOf(account.address)).toBeGreaterThan(0n);
  });

  it("does not claim success it did not have: a partial result is not an empty failed list", async () => {
    const { run } = setup({ failing: [T1, T2, T3] });
    const result = await run([T1, T2, T3]);
    expect(result.tokens).toBe(0);
    expect(result.failed).toHaveLength(3);
  });

  it("leaves ETH that is too small to move, and says so", async () => {
    const { account, node, run } = setup({ eth: 10_000n, tokens: {} });
    const result = await run([]);
    expect(result.ethSent).toBe(0n);
    expect(result.ethKept).toBe("dust");
    expect(node.ethOf(account.address)).toBe(10_000n);
  });

  it("sends only ETH when there are no tokens", async () => {
    const { node, run } = setup({ tokens: {} });
    const result = await run([]);
    expect(result).toMatchObject({ tokens: 0, failed: [] });
    expect(node.sent.map((s) => s.kind)).toEqual(["eth"]);
  });

  it("refuses to send anywhere but the connected main wallet, before doing anything", async () => {
    const { node, run } = setup();
    const elsewhere = "0x00000000000000000000000000000000000000ff" as Address;
    await expect(run([T1], elsewhere, MAIN)).rejects.toBeInstanceOf(WithdrawError);
    expect(node.sent).toHaveLength(0);
    expect(node.calls).not.toContain("eth_sendRawTransaction");
  });

  it("accepts the main wallet in any capitalisation", async () => {
    const { run } = setup({ tokens: {} });
    const mixed = MAIN.replace("a1", "A1") as Address;
    await expect(run([], mixed, MAIN)).resolves.toBeDefined();
  });

  it("never sends to the zero address, whatever it is told", async () => {
    const zero = "0x0000000000000000000000000000000000000000" as Address;
    const { run } = setup();
    await expect(run([T1], zero, zero)).rejects.toBeInstanceOf(WithdrawError);
  });
});
