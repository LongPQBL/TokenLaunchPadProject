import { prisma } from "@vezta/app-db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addr, seedToken } from "../../test/seed.js";
import { claimRow, resolvePending } from "./resolver.js";

const CHAIN = 11155111;
const GW = "https://gw.test";
const NOW = new Date("2026-01-01T00:00:00.000Z");
const DOC = "bafydocument";
const IMG = "bafyimage";
const T = addr(0x51);
const MIN = 60_000;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0]);

type Producer = () => Response | Error | Promise<Response>;
/** A fetch that answers by which content id the URL names, and remembers every URL it was asked for. */
function fakeFetch(routes: Record<string, Producer>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    for (const [fragment, produce] of Object.entries(routes)) {
      if (!url.includes(fragment)) continue;
      const out = await produce();
      if (out instanceof Error) throw out;
      return out;
    }
    return new Response("not found", { status: 404 });
  });
  return Object.assign(fn, { calls }) as typeof fn & { calls: string[] } & typeof globalThis.fetch;
}

const doc = (o: object = {}) => ({
  name: "Demo Token",
  symbol: "DEMO",
  description: "A token",
  image: `ipfs://${IMG}`,
  socials: { website: "https://example.com" },
  ...o,
});
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);
const happy = () => fakeFetch({ [DOC]: () => json(doc()), [IMG]: () => new Response(PNG) });
const run = (fetch: typeof globalThis.fetch, now = NOW, batch?: number) => resolvePending({ now, fetch, gateway: GW, batch });
const row = (token = T) => prisma.tokenMetadata.findUniqueOrThrow({ where: { chainId_token: { chainId: CHAIN, token } } });
const pendingRow = (token = T, uri = `ipfs://${DOC}`, extra: object = {}) =>
  prisma.tokenMetadata.create({ data: { chainId: CHAIN, token, uri, ...extra } });

beforeEach(async () => {
  await prisma.tokenMetadata.deleteMany();
  await seedToken.reset();
});
afterAll(() => prisma.$disconnect());

describe("resolvePending: success", () => {
  it("validates the document, checks the image and caches everything, marking the row ok", async () => {
    await pendingRow();
    expect(await run(happy())).toEqual({ resolved: 1, failed: 0 });
    const r = await row();
    expect(r).toMatchObject({
      status: "ok", name: "Demo Token", symbol: "DEMO", description: "A token",
      imageUri: `ipfs://${IMG}`, imageCdnUrl: `${GW}/ipfs/${IMG}`, socials: { website: "https://example.com" }, nextAttempt: null,
    });
    expect(r.fetchedAt).toBeInstanceOf(Date);
  });

  it("accepts a document with no image, and never fetches one", async () => {
    await pendingRow();
    const f = fakeFetch({ [DOC]: () => json(doc({ image: undefined })) });
    await run(f);
    expect((await row()).status).toBe("ok");
    expect((await row()).imageCdnUrl).toBeNull();
    expect(f.calls).toHaveLength(1);
  });

  it("accepts JPEG and WebP images as well as PNG", async () => {
    await pendingRow(addr(0x61), "ipfs://bafyjpeg");
    await pendingRow(addr(0x62), "ipfs://bafywebp");
    const f = fakeFetch({
      bafyjpeg: () => json(doc({ image: "ipfs://bafyjpg" })),
      bafywebp: () => json(doc({ image: "ipfs://bafywbp" })),
      bafyjpg: () => new Response(JPEG),
      bafywbp: () => new Response(WEBP),
    });
    expect(await run(f)).toEqual({ resolved: 2, failed: 0 });
  });
});

describe("resolvePending: transient failures keep the token pending", () => {
  it("retries after a network error, two minutes later, and counts the attempt", async () => {
    await pendingRow();
    expect(await run(fakeFetch({ [DOC]: () => new Error("ETIMEDOUT") }))).toEqual({ resolved: 0, failed: 1 });
    const r = await row();
    expect(r.status).toBe("pending");
    expect(r.attempts).toBe(1);
    expect(r.nextAttempt).toEqual(new Date(NOW.getTime() + 2 * MIN));
  });

  it("treats a gateway 5xx and a 429 as transient too", async () => {
    for (const status of [500, 502, 503, 429]) {
      await prisma.tokenMetadata.deleteMany();
      await pendingRow();
      await run(fakeFetch({ [DOC]: () => new Response("busy", { status }) }));
      expect((await row()).status, String(status)).toBe("pending");
    }
  });

  it("backs off exponentially: the second failure waits four minutes", async () => {
    await pendingRow();
    const failing = fakeFetch({ [DOC]: () => new Error("ETIMEDOUT") });
    await run(failing, NOW);
    const later = new Date(NOW.getTime() + 2 * MIN);
    await run(failing, later);
    const r = await row();
    expect(r.attempts).toBe(2);
    expect(r.nextAttempt).toEqual(new Date(later.getTime() + 4 * MIN));
  });

  it("gives up after five attempts and marks the token invalid", async () => {
    await pendingRow();
    const failing = fakeFetch({ [DOC]: () => new Error("ETIMEDOUT") });
    for (let i = 0; i < 5; i++) await run(failing, new Date(NOW.getTime() + i * 86_400_000));
    const r = await row();
    expect(r.attempts).toBe(5);
    expect(r.status).toBe("invalid");
  });

  it("leaves a row alone until it is due", async () => {
    await pendingRow(T, `ipfs://${DOC}`, { nextAttempt: new Date(NOW.getTime() + 10 * MIN), attempts: 1 });
    const f = happy();
    expect(await run(f)).toEqual({ resolved: 0, failed: 0 });
    expect(f).not.toHaveBeenCalled();
    expect((await row()).status).toBe("pending");
  });
});

describe("resolvePending: permanent failures are not retried", () => {
  const expectInvalid = async () => {
    const r = await row();
    expect(r.status).toBe("invalid");
    expect(r.attempts).toBe(1);
    expect(r.name).toBeNull();
  };

  it("marks a 404 or 403 invalid straight away", async () => {
    for (const status of [404, 403]) {
      await prisma.tokenMetadata.deleteMany();
      await pendingRow();
      await run(fakeFetch({ [DOC]: () => new Response("no", { status }) }));
      await expectInvalid();
    }
  });

  it("marks malformed JSON invalid", async () => {
    await pendingRow();
    await run(fakeFetch({ [DOC]: () => new Response("not json {") }));
    await expectInvalid();
  });

  it("marks a document that fails validation invalid", async () => {
    for (const bad of [{ name: "x".repeat(33) }, { symbol: "A B" }, { symbol: "A" }, { name: "" }]) {
      await prisma.tokenMetadata.deleteMany();
      await pendingRow();
      await run(fakeFetch({ [DOC]: () => json(doc(bad)), [IMG]: () => new Response(PNG) }));
      await expectInvalid();
    }
  });

  // SVG can carry script; the type is decided by the bytes, never by the URL or a header.
  it("marks an SVG image invalid, even when the URL says .png", async () => {
    await pendingRow();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    await run(fakeFetch({ [DOC]: () => json(doc()), [IMG]: () => new Response(svg, { headers: { "content-type": "image/png" } }) }));
    await expectInvalid();
  });

  it("marks an image over the 2 MB cap invalid", async () => {
    await pendingRow();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    await run(fakeFetch({ [DOC]: () => json(doc()), [IMG]: () => new Response(big) }));
    await expectInvalid();
  });

  it("stops reading a document that is far over the cap instead of downloading it all", async () => {
    await pendingRow();
    let pulled = 0;
    const huge = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulled++;
            controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
            if (pulled >= 10) controller.close();
          },
        }),
      );
    await run(fakeFetch({ [DOC]: huge }));
    await expectInvalid();
    expect(pulled).toBeLessThan(5); // 10 MB on offer; it gave up long before the end
  });
});

describe("resolvePending: it never fetches a host a stranger chose (SSRF)", () => {
  it("marks a non-ipfs metadata URI invalid without making any request", async () => {
    for (const uri of ["http://169.254.169.254/latest/meta-data/", "https://evil.example.com/x.json", "http://localhost:5432/", "file:///etc/passwd"]) {
      await prisma.tokenMetadata.deleteMany();
      await pendingRow(T, uri);
      const f = happy();
      await run(f);
      expect((await row()).status, uri).toBe("invalid");
      expect(f, uri).not.toHaveBeenCalled();
    }
  });

  it("marks a URI that tries to climb out of /ipfs/ invalid without making any request", async () => {
    await pendingRow(T, "ipfs://../../admin");
    const f = happy();
    await run(f);
    expect((await row()).status).toBe("invalid");
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses an http(s) image and never requests it", async () => {
    await pendingRow();
    const f = fakeFetch({ [DOC]: () => json(doc({ image: "https://evil.example.com/tracker.png" })) });
    await run(f);
    expect((await row()).status).toBe("invalid");
    expect(f.calls.every((u) => !u.includes("evil"))).toBe(true);
  });
});

describe("resolvePending: what it stores", () => {
  it("drops a hostile social link but keeps the rest of the document", async () => {
    await pendingRow();
    const f = fakeFetch({
      [DOC]: () => json(doc({ socials: { website: "javascript:alert(1)", twitter: "https://t.co/x" } })),
      [IMG]: () => new Response(PNG),
    });
    await run(f);
    const r = await row();
    expect(r.status).toBe("ok");
    expect(r.socials).toEqual({ twitter: "https://t.co/x" });
  });

  it("stores a name containing markup verbatim, leaving the escaping to the renderer", async () => {
    await pendingRow();
    await run(fakeFetch({ [DOC]: () => json(doc({ name: "<img src=x onerror=alert(1)>" })), [IMG]: () => new Response(PNG) }));
    const r = await row();
    expect(r.status).toBe("ok");
    expect(r.name).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("resolvePending: moderation and concurrency", () => {
  it("never touches a hidden token", async () => {
    await pendingRow(T, `ipfs://${DOC}`, { status: "hidden" });
    const f = happy();
    await run(f);
    expect(f).not.toHaveBeenCalled();
    expect((await row()).status).toBe("hidden");
  });

  // A moderator can hide a token while its metadata is being fetched. Writing the result back must not undo that.
  it("does not overwrite a token that was hidden while its metadata was being fetched", async () => {
    await pendingRow();
    const f = fakeFetch({
      [DOC]: async () => {
        await prisma.tokenMetadata.update({ where: { chainId_token: { chainId: CHAIN, token: T } }, data: { status: "hidden" } });
        return json(doc());
      },
      [IMG]: () => new Response(PNG),
    });
    await run(f);
    const r = await row();
    expect(r.status).toBe("hidden");
    expect(r.name).toBeNull();
  });

  it("fetches a token once when two passes overlap", async () => {
    await pendingRow();
    // The fetch is slow, so the second pass looks while the first is still mid-flight: the very case a lease is
    // for. With an instant fetch the first pass would finish and mark the row ok before the second even looked.
    const f = fakeFetch({
      [DOC]: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return json(doc());
      },
      [IMG]: () => new Response(PNG),
    });
    await Promise.all([run(f), run(f)]);
    expect(f.calls.filter((u) => u.includes(DOC))).toHaveLength(1);
    expect((await row()).status).toBe("ok");
  });

  it("takes at most `batch` rows per pass", async () => {
    for (let i = 0; i < 5; i++) await pendingRow(addr(0x70 + i));
    expect(await run(happy(), NOW, 2)).toEqual({ resolved: 2, failed: 0 });
    expect(await prisma.tokenMetadata.count({ where: { status: "ok" } })).toBe(2);
  });
});

describe("claimRow", () => {
  const readRow = async () => (await prisma.tokenMetadata.findUniqueOrThrow({ where: { chainId_token: { chainId: CHAIN, token: T } } }));

  // Two passes that both read the row before either wrote hold the same stale value. The database must let exactly
  // one of them claim it. This is the case a timing-based test cannot reliably reach, so it is tested head-on.
  it("lets exactly one of two claimers holding the same stale read win the row", async () => {
    await pendingRow();
    const stale = await readRow();
    const results = await Promise.all([claimRow(stale, NOW), claimRow(stale, NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a claim made on a read that has since been overtaken", async () => {
    await pendingRow();
    const stale = await readRow();
    expect(await claimRow(stale, NOW)).toBe(true);
    expect(await claimRow(stale, NOW)).toBe(false);
  });

  it("leases the row for five minutes", async () => {
    await pendingRow();
    await claimRow(await readRow(), NOW);
    expect((await readRow()).nextAttempt).toEqual(new Date(NOW.getTime() + 5 * MIN));
  });

  it("does not claim a row that is no longer pending", async () => {
    await pendingRow(T, `ipfs://${DOC}`, { status: "hidden" });
    expect(await claimRow(await readRow(), NOW)).toBe(false);
  });

  it("can claim a row again once the previous lease has been read fresh", async () => {
    await pendingRow();
    await claimRow(await readRow(), NOW);
    expect(await claimRow(await readRow(), new Date(NOW.getTime() + 6 * MIN))).toBe(true);
  });
});

describe("resolvePending: discovery", () => {
  it("creates a pending row for an indexed token that has a URI but no row, then resolves it in the same pass", async () => {
    await seedToken({ address: T, name: "Fresh", ticker: "FRS", metadataUri: `ipfs://${DOC}` });
    expect(await run(happy())).toEqual({ resolved: 1, failed: 0 });
    expect((await row()).status).toBe("ok");
  });

  it("ignores a token with no URI, and never disturbs a row that already exists", async () => {
    await seedToken({ address: addr(0x52), name: "NoUri", ticker: "NU" });
    await seedToken({ address: addr(0x53), name: "Hidden", ticker: "HD", metadataUri: `ipfs://${DOC}` });
    await pendingRow(addr(0x53), `ipfs://${DOC}`, { status: "hidden" });
    const f = happy();
    await run(f);
    expect(await prisma.tokenMetadata.findUnique({ where: { chainId_token: { chainId: CHAIN, token: addr(0x52) } } })).toBeNull();
    expect((await row(addr(0x53))).status).toBe("hidden");
    expect(f).not.toHaveBeenCalled();
  });
});
