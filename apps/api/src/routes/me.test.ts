import { prisma } from "@vezta/app-db";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetAppData } from "../../test/app-data.js";
import { randomAccount, signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI } from "../../test/auth.js";
import { jpeg, png, SVG, webp } from "../../test/images.js";
import { addr, seedToken } from "../../test/seed.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";
import { fakePinner } from "../metadata/pin.js";

const pinner = fakePinner();
const app = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN }, pinner, ipfsGateway: "https://gw.example" });
const T = addr(0x71);
const NUL = String.fromCharCode(0);

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
  await resetAppData();
  await seedToken.reset();
  await seedToken({ address: T, name: "Demo", ticker: "DEMO" });
  pinner.files.length = 0;
  pinner.jsons.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
  await getSql().end();
});

async function session(account = randomAccount()) {
  const signed = await signIn(app, account);
  expect(signed.cookie).toMatch(/^vezta_session=/);
  return signed;
}

/** PUT /me with the given fields. A File value is sent as a file. */
function put(cookie: string | null, fields: Record<string, string | Blob>, method = "PUT") {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Blob) form.set(k, v, "avatar.bin");
    else form.set(k, v);
  }
  return app.request("/me", { method, headers: cookie ? { cookie } : {}, body: form });
}
const file = (bytes: Buffer, type: string) => new File([new Uint8Array(bytes)], "a", { type });

describe("PUT /me: username", () => {
  it("needs a session, and changes nothing without one", async () => {
    expect((await put(null, { username: "alice" })).status).toBe(401);
    expect(await prisma.appUser.count()).toBe(0);
  });

  it("sets the username of the SESSION address, making the account if there is none", async () => {
    const { cookie, address } = await session();
    const res = await put(cookie, { username: "alice" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address, username: "alice" });
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address } })).username).toBe("alice");
  });

  it("cannot be pointed at someone else: no field names whose account it is", async () => {
    const a = await session();
    const b = await session();
    await put(a.cookie, { username: "alice", address: b.address, author: b.address });
    expect(await prisma.appUser.findUnique({ where: { address: b.address } })).toBeNull();
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: a.address } })).username).toBe("alice");
  });

  it("trims the ends, and keeps the case the person chose", async () => {
    const { cookie, address } = await session();
    await put(cookie, { username: "  MixedCase_9  " });
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address } })).username).toBe("MixedCase_9");
  });

  it("refuses a name that is taken, whatever its case, and says so with a code the page can act on", async () => {
    const a = await session();
    const b = await session();
    await put(a.cookie, { username: "Alice" });
    for (const name of ["Alice", "alice", "ALICE"]) {
      const res = await put(b.cookie, { username: name });
      expect(res.status, name).toBe(409);
      expect(((await res.json()) as { error: string }).error).toBe("username_taken");
    }
    expect((await prisma.appUser.findUnique({ where: { address: b.address } }))?.username ?? null).toBeNull();
  });

  it("lets a person keep, or change the case of, their own name", async () => {
    const { cookie } = await session();
    await put(cookie, { username: "alice" });
    expect((await put(cookie, { username: "alice" })).status).toBe(200);
    expect((await put(cookie, { username: "Alice" })).status).toBe(200);
  });

  it("refuses what is not a plain name: markup, whitespace inside, punctuation, too short or too long, an emoji", async () => {
    const { cookie } = await session();
    for (const bad of ["<b>bold</b>", "has space", "semi;colon", "dash-name", "dot.name", "ab", "a".repeat(21), "emoji😀", "tab\tname", `nul${NUL}x`]) {
      const res = await put(cookie, { username: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("bad_username");
    }
  });

  it("refuses a name that looks like an address, which could pass for someone else", async () => {
    const { cookie } = await session();
    for (const bad of ["0x1a2b3c4d", "0X1A2B3C", "0xdeadbeef"]) expect((await put(cookie, { username: bad })).status, bad).toBe(400);
  });

  it("clears the name when sent empty, freeing it for someone else", async () => {
    const a = await session();
    const b = await session();
    await put(a.cookie, { username: "alice" });
    const res = await put(a.cookie, { username: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ address: a.address });
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address: a.address } })).username).toBeNull();
    expect((await put(b.cookie, { username: "alice" })).status).toBe(200);
  });

  it("changes only what is sent: a request with no fields is refused, and a name alone leaves the picture", async () => {
    const { cookie, address } = await session();
    expect((await put(cookie, {})).status).toBe(400);
    await prisma.appUser.create({ data: { address, avatarUri: "ipfs://bafyold" } });
    await put(cookie, { username: "alice" });
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address } })).avatarUri).toBe("ipfs://bafyold");
  });

  it("shows beside the person's existing comments at once", async () => {
    const { cookie, address } = await session();
    await prisma.appUser.create({ data: { address } });
    await prisma.comment.create({ data: { chainId: 11155111, token: T, author: address, body: "gm" } });
    const before = (await (await app.request(`/sepolia/tokens/${T}/comments`)).json()) as { items: { username?: string }[] };
    expect(before.items[0]!.username).toBeUndefined();
    await put(cookie, { username: "alice" });
    const after = (await (await app.request(`/sepolia/tokens/${T}/comments`)).json()) as { items: { username?: string }[] };
    expect(after.items[0]!.username).toBe("alice");
  });

  it("is refused to a banned person, and nothing changes", async () => {
    const { cookie, address } = await session();
    await prisma.appUser.create({ data: { address, bannedAt: new Date() } });
    expect((await put(cookie, { username: "alice" })).status).toBe(403);
    expect((await prisma.appUser.findUniqueOrThrow({ where: { address } })).username).toBeNull();
  });

  // A page on another site can send a form POST with the cookie only if SameSite allows; PUT cannot come from a form at all.
  it("is a PUT and nothing else: a form's POST does nothing", async () => {
    const { cookie, address } = await session();
    const res = await put(cookie, { username: "alice" }, "POST");
    expect(res.status).toBe(404);
    expect(await prisma.appUser.findUnique({ where: { address } })).toBeNull();
  });

  it("refuses a request far bigger than any profile, before reading it", async () => {
    const { cookie } = await session();
    const res = await app.request("/me", { method: "PUT", headers: { cookie, "content-type": "multipart/form-data; boundary=x" }, body: "x".repeat(5 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it("limits how often a profile can be changed", async () => {
    const { cookie } = await session();
    let last = 0;
    for (let i = 0; i < 30; i++) {
      last = (await put(cookie, { username: `name_${i}` })).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe("PUT /me: avatar", () => {
  it("re-encodes the picture and pins it through the same path as a token's logo, then stores its ipfs reference", async () => {
    const { cookie, address } = await session();
    const trailer = Buffer.from("<script>alert(1)</script>");
    const original = Buffer.concat([await png(256), trailer]); // something hiding after the image
    const res = await put(cookie, { avatar: file(original, "image/png") });
    expect(res.status).toBe(200);
    expect(pinner.files).toHaveLength(1);
    const [pinned] = pinner.files;
    expect(pinned!.contentType).toBe("image/png");
    expect(pinned!.bytes.includes(trailer)).toBe(false); // encoded again from its pixels, not passed through
    const stored = (await prisma.appUser.findUniqueOrThrow({ where: { address } })).avatarUri!;
    expect(stored).toMatch(/^ipfs:\/\/bafyfake/);
    const body = (await res.json()) as { avatarUrl: string };
    expect(body.avatarUrl).toBe(`https://gw.example/ipfs/${stored.slice("ipfs://".length)}`);
  });

  it("keeps a picture's type, for PNG, JPEG and WebP", async () => {
    const { cookie } = await session();
    for (const [bytes, type] of [[await png(), "image/png"], [await jpeg(), "image/jpeg"], [await webp(), "image/webp"]] as const) {
      expect((await put(cookie, { avatar: file(bytes, type) })).status, type).toBe(200);
    }
    expect(pinner.files.map((f) => f.contentType)).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });

  it("is SVG-free: an SVG, even one declared as a PNG, is refused and nothing is pinned", async () => {
    const { cookie, address } = await session();
    for (const declared of ["image/svg+xml", "image/png"]) {
      const res = await put(cookie, { avatar: file(SVG, declared) });
      expect(res.status, declared).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("bad_image");
    }
    expect(pinner.files).toHaveLength(0);
    expect(await prisma.appUser.findUnique({ where: { address } })).toBeNull();
  });

  it("refuses a file that is not an image, an image that will not decode, and a picture over 2 MB", async () => {
    const { cookie } = await session();
    expect((await put(cookie, { avatar: file(Buffer.from("hello"), "image/png") })).status).toBe(400);
    expect((await put(cookie, { avatar: file((await png()).subarray(0, 30), "image/png") })).status).toBe(400);
    expect((await put(cookie, { avatar: file(Buffer.alloc(2 * 1024 * 1024 + 1), "image/png") })).status).toBe(400);
    expect(pinner.files).toHaveLength(0);
  });

  it("scales a large picture down: nobody needs a 4000-pixel avatar", async () => {
    const { cookie } = await session();
    await put(cookie, { avatar: file(await png(3000), "image/png") });
    const meta = await sharp(pinner.files[0]!.bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);
  });

  it("removes the picture on request, without touching the name", async () => {
    const { cookie, address } = await session();
    await prisma.appUser.create({ data: { address, username: "alice", avatarUri: "ipfs://bafyold" } });
    const res = await put(cookie, { removeAvatar: "true" });
    expect(res.status).toBe(200);
    expect(await prisma.appUser.findUniqueOrThrow({ where: { address } })).toMatchObject({ username: "alice", avatarUri: null });
  });

  it("changes the name and the picture together, or neither: a refused picture does not leave the name changed", async () => {
    const { cookie, address } = await session();
    const res = await put(cookie, { username: "alice", avatar: file(SVG, "image/png") });
    expect(res.status).toBe(400);
    expect(await prisma.appUser.findUnique({ where: { address } })).toBeNull();
  });

  it("does not use the picture when the name is refused", async () => {
    const { cookie } = await session();
    await put(cookie, { username: "has space", avatar: file(await png(), "image/png") });
    expect(pinner.files).toHaveLength(0); // nothing pinned that would never be used
  });

  it("limits pictures to five an hour, and a refused picture does not count", async () => {
    const { cookie } = await session();
    for (let i = 0; i < 10; i++) await put(cookie, { avatar: file(SVG, "image/png") });
    const bytes = await png();
    for (let i = 0; i < 5; i++) expect((await put(cookie, { avatar: file(bytes, "image/png") })).status, `picture ${i + 1}`).toBe(200);
    const sixth = await put(cookie, { avatar: file(bytes, "image/png") });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("answers 503 for a picture when nothing can pin, and still takes a name", async () => {
    const bare = createApp({ auth: { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN } });
    const { cookie } = await signIn(bare, randomAccount());
    const form = new FormData();
    form.set("avatar", new File([new Uint8Array(await png())], "a.png", { type: "image/png" }));
    expect((await bare.request("/me", { method: "PUT", headers: { cookie }, body: form })).status).toBe(503);
    const named = new FormData();
    named.set("username", "alice");
    expect((await bare.request("/me", { method: "PUT", headers: { cookie }, body: named })).status).toBe(200);
  });
});
