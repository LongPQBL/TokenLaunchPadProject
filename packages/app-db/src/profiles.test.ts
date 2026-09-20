import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./index.js";

const SEPOLIA = 11155111;

beforeEach(async () => {
  await prisma.comment.deleteMany();
  await prisma.report.deleteMany();
  await prisma.tokenMetadata.deleteMany();
  await prisma.appUser.deleteMany();
});
afterAll(() => prisma.$disconnect());

describe("usernames", () => {
  it("accepts a null username: most people never set one", async () => {
    await prisma.appUser.create({ data: { address: "0xa1" } });
    await prisma.appUser.create({ data: { address: "0xa2" } });
    expect(await prisma.appUser.count({ where: { username: null } })).toBe(2);
  });

  it("rejects a duplicate username whatever its case: 'Alice' and 'alice' are one name", async () => {
    await prisma.appUser.create({ data: { address: "0xa1", username: "Alice" } });
    await expect(prisma.appUser.create({ data: { address: "0xa2", username: "alice" } })).rejects.toThrow();
    await expect(prisma.appUser.create({ data: { address: "0xa3", username: "ALICE" } })).rejects.toThrow();
    await expect(prisma.appUser.create({ data: { address: "0xa4", username: "bob" } })).resolves.toBeDefined();
  });

  it("rejects a username with whitespace, markup or the wrong length: it is shown beside other people's words", async () => {
    for (const bad of ["ab", "a".repeat(21), "has space", "<b>bold</b>", "semi;colon", "emoji😀", "tab\tname", "new\nline", "dash-name", "dot.name"]) {
      await expect(prisma.appUser.create({ data: { address: `0x${Math.random().toString(16).slice(2)}`, username: bad } }), JSON.stringify(bad)).rejects.toThrow();
    }
    for (const good of ["abc", "a".repeat(20), "Under_score9", "UPPER"]) {
      await expect(prisma.appUser.create({ data: { address: `0x${Math.random().toString(16).slice(2)}`, username: good } }), good).resolves.toBeDefined();
    }
  });

  it("lets a person clear their username, freeing it for someone else", async () => {
    await prisma.appUser.create({ data: { address: "0xa1", username: "taken" } });
    await prisma.appUser.update({ where: { address: "0xa1" }, data: { username: null } });
    await expect(prisma.appUser.create({ data: { address: "0xa2", username: "taken" } })).resolves.toBeDefined();
  });

  it("stores an avatar reference and a ban time, both optional", async () => {
    const user = await prisma.appUser.create({ data: { address: "0xa1" } });
    expect(user.avatarUri).toBeNull();
    expect(user.bannedAt).toBeNull();
    const banned = await prisma.appUser.update({ where: { address: "0xa1" }, data: { bannedAt: new Date(), avatarUri: "ipfs://bafyabcde" } });
    expect(banned.bannedAt).toBeInstanceOf(Date);
    expect(banned.avatarUri).toBe("ipfs://bafyabcde");
  });
});

describe("moderation audit trail", () => {
  it("records who hid a token and when", async () => {
    const at = new Date("2026-09-21T10:00:00Z");
    const row = await prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: "0xcc", uri: "ipfs://x", status: "hidden", hiddenBy: "0xadmin", hiddenAt: at } });
    expect(row).toMatchObject({ status: "hidden", hiddenBy: "0xadmin" });
    expect(row.hiddenAt?.toISOString()).toBe(at.toISOString());
  });

  it("leaves both empty for a token nobody has hidden", async () => {
    const row = await prisma.tokenMetadata.create({ data: { chainId: SEPOLIA, token: "0xcd", uri: "ipfs://x" } });
    expect(row.hiddenBy).toBeNull();
    expect(row.hiddenAt).toBeNull();
  });
});

describe("what earlier groups guaranteed still holds", () => {
  it("still caps a comment body at 500 characters in the database", async () => {
    await prisma.appUser.create({ data: { address: "0xaa" } });
    await expect(prisma.comment.create({ data: { chainId: SEPOLIA, token: "0xbb", author: "0xaa", body: "x".repeat(501) } })).rejects.toThrow();
    await expect(prisma.comment.create({ data: { chainId: SEPOLIA, token: "0xbb", author: "0xaa", body: "x".repeat(500) } })).resolves.toBeDefined();
  });
});
