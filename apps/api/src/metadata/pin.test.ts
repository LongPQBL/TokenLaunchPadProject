import { describe, expect, it, vi } from "vitest";
import { fakePinner, PinError, pinataPinner } from "./pin.js";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
// What Pinata's Files API answers with.
const ok = (cid = CID) => new Response(JSON.stringify({ data: { id: "1", cid, cid_version: "v1", network: "public", size: 1 } }), { status: 200 });

describe("pinataPinner", () => {
  it("uploads a file as multipart to the public network with the JWT, asking for CIDv1, and returns the CID", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ok());
    const cid = await pinataPinner("secret-jwt", fetchMock).pinFile(Buffer.from("bytes"), "logo.png", "image/png");

    expect(cid).toBe(CID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://uploads.pinata.cloud/v3/files");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer secret-jwt");
    const form = init!.body as FormData;
    expect((form.get("file") as File).name).toBe("logo.png");
    expect((form.get("file") as File).type).toBe("image/png");
    expect(form.get("network")).toBe("public"); // an IPFS URI on chain has to be readable by anyone
    expect(form.get("cid_version")).toBe("v1");
    expect(form.get("name")).toBe("logo.png");
  });

  it("pins a JSON document as a file of its own, so its CID is the document's and a gateway serves it as it is", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ok());
    const cid = await pinataPinner("secret-jwt", fetchMock).pinJson({ name: "Demo" }, "demo.json");
    expect(cid).toBe(CID);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://uploads.pinata.cloud/v3/files");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer secret-jwt");
    const form = init!.body as FormData;
    const file = form.get("file") as File;
    expect(file.name).toBe("demo.json");
    expect(file.type).toBe("application/json");
    expect(JSON.parse(await file.text())).toEqual({ name: "Demo" });
    expect(form.get("network")).toBe("public");
    expect(form.get("cid_version")).toBe("v1");
  });

  it("never lets Pinata's error text, or the key, out: a failure is a PinError with a fixed message", async () => {
    const leaky = vi.fn<typeof fetch>(async () => new Response('{"error":"invalid JWT secret-jwt for account 42"}', { status: 401 }));
    const err = await pinataPinner("secret-jwt", leaky).pinFile(Buffer.from("x"), "a.png", "image/png").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PinError);
    expect(String((err as Error).message)).not.toMatch(/secret-jwt|account 42|invalid JWT/);
    expect((err as PinError).status).toBe(401); // the status is kept, for the operator's log
  });

  it("does not accept a failed response just because its body happens to contain a CID", async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: { cid: CID } }), { status: 500 }));
    await expect(pinataPinner("k", f).pinJson({}, "x")).rejects.toBeInstanceOf(PinError);
  });

  it("treats a network failure as a PinError too, and does not echo the cause", async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new Error("connect ECONNREFUSED with Authorization: Bearer secret-jwt");
    });
    const err = await pinataPinner("secret-jwt", down).pinJson({}, "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PinError);
    expect(String((err as Error).message)).not.toContain("secret-jwt");
  });

  it("refuses an answer that is not a CID: it becomes part of an on-chain URI", async () => {
    for (const bad of ["", "ipfs://x", "../etc/passwd", "a".repeat(200), "has space"]) {
      const f = vi.fn<typeof fetch>(async () => ok(bad));
      await expect(pinataPinner("k", f).pinFile(Buffer.from("x"), "a.png", "image/png"), JSON.stringify(bad)).rejects.toBeInstanceOf(PinError);
    }
    const noHash = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await expect(pinataPinner("k", noHash).pinJson({}, "x")).rejects.toBeInstanceOf(PinError);
    const notJson = vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 }));
    await expect(pinataPinner("k", notJson).pinJson({}, "x")).rejects.toBeInstanceOf(PinError);
  });

  it("gives up on a request that hangs", async () => {
    // Settles only if the request carries a signal that fires: a pinner with no timeout would wait forever.
    const hang = vi.fn<typeof fetch>((_url, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted")))));
    await expect(pinataPinner("k", hang, 30).pinJson({}, "x")).rejects.toBeInstanceOf(PinError);
  });
});

describe("fakePinner", () => {
  it("returns a stable, well-formed CID for the same content, and a different one for different content", async () => {
    const p = fakePinner();
    const a = await p.pinFile(Buffer.from("one"), "a.png", "image/png");
    expect(a).toMatch(/^[A-Za-z0-9]{5,100}$/);
    expect(await p.pinFile(Buffer.from("one"), "b.png", "image/png")).toBe(a);
    expect(await p.pinFile(Buffer.from("two"), "a.png", "image/png")).not.toBe(a);
    expect(await p.pinJson({ x: 1 }, "x.json")).toMatch(/^[A-Za-z0-9]{5,100}$/);
  });

  it("remembers what it was given, so a test can look at exactly what would have been pinned", async () => {
    const p = fakePinner();
    await p.pinFile(Buffer.from("img"), "a.png", "image/png");
    await p.pinJson({ name: "Demo" }, "demo.json");
    expect(p.files).toHaveLength(1);
    expect(p.files[0]!.bytes.toString()).toBe("img");
    expect(p.jsons[0]!.value).toEqual({ name: "Demo" });
  });
});
