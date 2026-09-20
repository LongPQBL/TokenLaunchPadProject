import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { signIn, TEST_CHAIN, TEST_DOMAIN, TEST_URI, randomAccount } from "../../test/auth.js";
import { jpeg, png, SVG } from "../../test/images.js";
import { createApp } from "../app.js";
import { getSql } from "../db.js";
import { fakePinner, PinError, type Pinner } from "../metadata/pin.js";

const auth = { domain: TEST_DOMAIN, uri: TEST_URI, chainId: TEST_CHAIN };

beforeEach(async () => {
  await getSql()`truncate app.siwe_nonce, app.session, app.rate_hit`;
});
afterAll(() => getSql().end());

interface Upload {
  image?: { bytes: Buffer; type?: string; name?: string } | null;
  fields?: Record<string, string>;
}

function setup(pinner: Pinner | null = fakePinner()) {
  const app = createApp({ auth, pinner: pinner ?? undefined });
  const upload = async (cookie: string | undefined, { image, fields }: Upload = {}) => {
    const form = new FormData();
    const values = { name: "Demo Token", ticker: "demo", description: "About it", antiSniperWindow: "60", ...fields };
    for (const [k, v] of Object.entries(values)) form.append(k, v);
    if (image !== null) {
      const { bytes, type = "image/png", name = "logo.png" } = image ?? { bytes: await png() };
      form.append("image", new File([new Uint8Array(bytes)], name, { type }));
    }
    return app.request("/metadata", { method: "POST", body: form, headers: cookie ? { cookie } : {} });
  };
  return { app, upload, pinner };
}

async function signedIn(app: ReturnType<typeof setup>["app"]) {
  return (await signIn(app)).cookie;
}

describe("POST /metadata: the accepted path", () => {
  it("pins the image, then the metadata document that names it, and returns only the document's URI", async () => {
    const pinner = fakePinner();
    const { app, upload } = setup(pinner);
    const res = await upload(await signedIn(app), { fields: { website: "https://example.com" } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { metadataURI: string };
    expect(Object.keys(body)).toEqual(["metadataURI"]);
    expect(body.metadataURI).toMatch(/^ipfs:\/\/[A-Za-z0-9]{5,100}$/);

    expect(pinner.files).toHaveLength(1);
    expect(pinner.files[0]!.contentType).toBe("image/png");
    expect(pinner.jsons).toHaveLength(1);
    const imageCid = body.metadataURI; // the document, not the image
    expect(imageCid).not.toContain(pinner.jsons[0]!.name);
    expect(pinner.jsons[0]!.value).toMatchObject({
      name: "Demo Token",
      symbol: "DEMO",
      description: "About it",
      socials: { website: "https://example.com" },
    });
    expect((pinner.jsons[0]!.value as { image: string }).image).toMatch(/^ipfs:\/\/bafyfake/);
  });

  it("accepts JPEG too", async () => {
    const { app, upload } = setup();
    const res = await upload(await signedIn(app), { image: { bytes: await jpeg(), type: "image/jpeg", name: "logo.jpg" } });
    expect(res.status).toBe(200);
  });
});

describe("POST /metadata: the image is untrusted", () => {
  it("refuses an SVG even when it claims to be a PNG", async () => {
    const pinner = fakePinner();
    const { app, upload } = setup(pinner);
    const res = await upload(await signedIn(app), { image: { bytes: SVG, type: "image/png", name: "x.png" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_image");
    expect(pinner.files).toHaveLength(0);
  });

  it("refuses an image above the 2 MB cap, before decoding it", async () => {
    const pinner = fakePinner();
    const { app, upload } = setup(pinner);
    const big = Buffer.concat([await png(), Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const res = await upload(await signedIn(app), { image: { bytes: big } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_image");
    expect(pinner.files).toHaveLength(0);
  });

  it("refuses a file that is not an image at all", async () => {
    const { app, upload } = setup();
    const res = await upload(await signedIn(app), { image: { bytes: Buffer.from("plain text, not a picture"), type: "image/png" } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_image");
  });

  it("refuses a request with no image", async () => {
    const { app, upload } = setup();
    const res = await upload(await signedIn(app), { image: null });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_image");
  });

  it("refuses an image field that is really text", async () => {
    const { app } = setup();
    const cookie = await signedIn(app);
    const form = new FormData();
    for (const [k, v] of Object.entries({ name: "Demo", ticker: "DEMO" })) form.append(k, v);
    form.append("image", "just a string");
    const res = await app.request("/metadata", { method: "POST", body: form, headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it("pins the re-encoded pixels, not the upload: a script appended to a valid PNG never reaches IPFS", async () => {
    const pinner = fakePinner();
    const { app, upload } = setup(pinner);
    const dirty = Buffer.concat([await png(), Buffer.from("<script>alert(1)</script>")]);
    const res = await upload(await signedIn(app), { image: { bytes: dirty } });
    expect(res.status).toBe(200);
    expect(pinner.files[0]!.bytes.includes("<script>")).toBe(false);
  });

  it("refuses a body far larger than any image, without buffering all of it", async () => {
    const { app, upload } = setup();
    const res = await upload(await signedIn(app), { image: { bytes: Buffer.alloc(6 * 1024 * 1024, 1) } });
    expect(res.status).toBe(413);
  });
});

describe("POST /metadata: the form is validated here, whatever the browser did", () => {
  it.each([
    ["a ticker with a space", { ticker: "AB CD" }, "ticker"],
    ["a 1-character ticker", { ticker: "A" }, "ticker"],
    ["a 33-character name", { name: "x".repeat(33) }, "name"],
    ["an empty name", { name: "" }, "name"],
    ["a javascript: website", { website: "javascript:alert(1)" }, "website"],
    ["a window the contract does not accept", { antiSniperWindow: "30" }, "antiSniperWindow"],
    ["a window that is not a number", { antiSniperWindow: "soon" }, "antiSniperWindow"],
    ["a description over 500 characters", { description: "x".repeat(501) }, "description"],
  ])("refuses %s, and says which field", async (_label, fields, field) => {
    const pinner = fakePinner();
    const { app, upload } = setup(pinner);
    const res = await upload(await signedIn(app), { fields });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: string[] };
    expect(body.error).toBe("bad_form");
    expect(body.fields).toContain(field);
    expect(pinner.files).toHaveLength(0);
  });

  it("does not echo what was submitted back in the error", async () => {
    const { app, upload } = setup();
    const res = await upload(await signedIn(app), { fields: { website: "javascript:alert('reflected')" } });
    expect(JSON.stringify(await res.json())).not.toContain("reflected");
  });
});

describe("POST /metadata: who may upload, and how often", () => {
  it("needs a session: nothing is parsed, decoded or pinned without one", async () => {
    const pinner = fakePinner();
    const { upload } = setup(pinner);
    const res = await upload(undefined);
    expect(res.status).toBe(401);
    expect(pinner.files).toHaveLength(0);
  });

  it("limits each address to five uploads an hour", async () => {
    const { app, upload } = setup();
    const cookie = await signedIn(app);
    for (let i = 0; i < 5; i++) expect((await upload(cookie)).status, `upload ${i + 1}`).toBe(200);
    const sixth = await upload(cookie);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts each address on its own", async () => {
    const { app, upload } = setup();
    const a = await signedIn(app);
    const b = (await signIn(app, randomAccount())).cookie;
    for (let i = 0; i < 5; i++) await upload(a);
    expect((await upload(a)).status).toBe(429);
    expect((await upload(b)).status).toBe(200);
  });

  it("does not count an upload that was refused as invalid: fixing a typo is free", async () => {
    const { app, upload } = setup();
    const cookie = await signedIn(app);
    for (let i = 0; i < 10; i++) await upload(cookie, { fields: { ticker: "bad ticker" } });
    for (let i = 0; i < 5; i++) expect((await upload(cookie)).status).toBe(200);
  });
});

describe("POST /metadata: when pinning goes wrong", () => {
  it("never returns the key, or the pinning service's own error, to the client", async () => {
    const failing: Pinner = {
      pinFile: async () => {
        throw new PinError(401);
      },
      pinJson: async () => "unused",
    };
    const { app, upload } = setup(failing);
    const res = await upload(await signedIn(app));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "pin_failed", message: "Could not store the image right now. Please try again." });
  });

  it("does not pin a document that points at an image that failed to pin", async () => {
    let jsonPinned = false;
    const pinner: Pinner = {
      pinFile: async () => {
        throw new PinError();
      },
      pinJson: async () => {
        jsonPinned = true;
        return "x";
      },
    };
    const { app, upload } = setup(pinner);
    await upload(await signedIn(app));
    expect(jsonPinned).toBe(false);
  });

  it("treats an unexpected pinner failure as a server error without leaking its message", async () => {
    const boom: Pinner = {
      pinFile: async () => {
        throw new Error("Bearer secret-jwt-in-a-stack-trace");
      },
      pinJson: async () => "x",
    };
    const { app, upload } = setup(boom);
    const res = await upload(await signedIn(app));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret-jwt");
  });

  it("says uploads are unavailable when no pinning service is configured, rather than pretending", async () => {
    const { app, upload } = setup(null);
    const res = await upload(await signedIn(app));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("uploads_unavailable");
  });
});
