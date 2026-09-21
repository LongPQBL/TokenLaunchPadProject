import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;

beforeEach(async () => {
  await prisma.comment.deleteMany();
  await prisma.report.deleteMany();
  await prisma.tokenMetadata.deleteMany();
  await prisma.appUser.deleteMany();
});
afterAll(() => prisma.$disconnect());

describe("app schema", () => {
  it("enforces the 500-character comment limit at the database level", async () => {
    await prisma.appUser.create({ data: { address: "0xaa" } });
    await expect(
      prisma.comment.create({ data: { chainId: SEPOLIA, token: "0xbb", author: "0xaa", body: "x".repeat(501) } }),
    ).rejects.toThrow();
    // ...and exactly 500 is fine, so the limit is not off by one.
    await expect(
      prisma.comment.create({ data: { chainId: SEPOLIA, token: "0xbb", author: "0xaa", body: "x".repeat(500) } }),
    ).resolves.toMatchObject({ body: "x".repeat(500) });
  });

  it("stores token metadata keyed by (chainId, token), defaulting to pending", async () => {
    await prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: "0xcc", uri: "ipfs://x" } });
    const row = await prisma.tokenMetadata.findUnique({ where: { chainId_token: { chainId: SEPOLIA, token: "0xcc" } } });
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
  });

  it("allows the same address on two chains but not twice on one", async () => {
    await prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: "0xdd", uri: "ipfs://a" } });
    await expect(
      prisma.tokenMetadata.create({ data: { chainId: BASE_SEPOLIA, token: "0xdd", uri: "ipfs://b" } }),
    ).resolves.toBeDefined();
    await expect(
      prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: "0xdd", uri: "ipfs://c" } }),
    ).rejects.toThrow();
  });

  it("rejects a comment whose author is not a known user", async () => {
    await expect(
      prisma.comment.create({ data: { chainId: SEPOLIA, token: "0xee", author: "0xghost", body: "hi" } }),
    ).rejects.toThrow();
  });

  it("keeps comments hidden=false by default and never deletes on hide", async () => {
    await prisma.appUser.create({ data: { address: "0xff" } });
    const c = await prisma.comment.create({ data: { chainId: SEPOLIA, token: "0x11", author: "0xff", body: "hi" } });
    expect(c.hidden).toBe(false);
    await prisma.comment.update({ where: { id: c.id }, data: { hidden: true } });
    expect(await prisma.comment.count()).toBe(1);
  });
});
