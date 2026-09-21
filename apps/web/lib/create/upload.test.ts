import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { checkImage, createUploader } from "./upload";

const form = { name: "Demo", ticker: "DEMO", description: "d", antiSniperWindow: 60 as const, website: "https://example.com" };
const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
const upload = createUploader({ baseUrl: API });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("checkImage", () => {
  const file = (size: number, type: string) => new File([new Uint8Array(size)], "x", { type });

  it("accepts PNG, JPEG and WebP up to 2 MB", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) expect(checkImage(file(1000, type))).toBe(true);
    expect(checkImage(file(2 * 1024 * 1024, "image/png"))).toBe(true);
  });

  it("refuses what the API would: SVG, GIF, an empty file, and anything above 2 MB", () => {
    expect(checkImage(file(1000, "image/svg+xml"))).toBe(false);
    expect(checkImage(file(1000, "image/gif"))).toBe(false);
    expect(checkImage(file(0, "image/png"))).toBe(false);
    expect(checkImage(file(2 * 1024 * 1024 + 1, "image/png"))).toBe(false);
  });
});

describe("createUploader", () => {
  it("sends the form and the logo as multipart, with the session cookie, and returns the URI", async () => {
    let seen: Request | undefined;
    let fields: Record<string, FormDataEntryValue> = {};
    server.use(
      http.post(`${API}/metadata`, async ({ request }) => {
        seen = request;
        fields = Object.fromEntries(await request.formData());
        return HttpResponse.json({ metadataURI: "ipfs://bafyabcde" });
      }),
    );
    expect(await upload(form, image)).toBe("ipfs://bafyabcde");
    expect(seen!.credentials).toBe("include");
    expect(fields).toMatchObject({ name: "Demo", ticker: "DEMO", description: "d", antiSniperWindow: "60", website: "https://example.com" });
    expect((fields.image as File).name).toBe("logo.png");
    expect(fields).not.toHaveProperty("twitter"); // not given, not sent
  });

  it("carries the server's own words on a refusal, with its code", async () => {
    server.use(http.post(`${API}/metadata`, () => HttpResponse.json({ error: "rate_limited", message: "Try later." }, { status: 429 })));
    await expect(upload(form, image)).rejects.toMatchObject({ name: "ApiError", status: 429, code: "rate_limited", message: "Try later." });
  });

  it("reports an unreachable server as a network error", async () => {
    server.use(http.post(`${API}/metadata`, () => HttpResponse.error()));
    await expect(upload(form, image)).rejects.toMatchObject({ code: "network" });
  });

  it("does not trust an answer that is not an ipfs:// URI: it is about to go on chain", async () => {
    for (const metadataURI of ["https://evil.example/x", "ipfs://../x", "", 5, "javascript:alert(1)"]) {
      server.use(http.post(`${API}/metadata`, () => HttpResponse.json({ metadataURI })));
      await expect(upload(form, image), String(metadataURI)).rejects.toMatchObject({ code: "bad_response" });
    }
  });
});
