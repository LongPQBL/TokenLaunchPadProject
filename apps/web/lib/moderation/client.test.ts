import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ADDR } from "../../test/msw/fixtures";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createModerationApi } from "./client";

const moderation = createModerationApi({ baseUrl: API });
const T = ADDR(0xa1);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Records what a POST looked like on the wire. */
function capture(path: string, reply: { status?: number; body?: unknown } = {}) {
  const seen: { url: URL; body: unknown; type: string | null; credentials: string; method: string }[] = [];
  server.use(
    http.post(`${API}${path}`, async ({ request }) => {
      seen.push({
        url: new URL(request.url),
        body: await request.json().catch(() => undefined),
        type: request.headers.get("content-type"),
        credentials: request.credentials,
        method: request.method,
      });
      return HttpResponse.json((reply.body ?? { ok: true }) as never, { status: reply.status ?? 200 });
    }),
  );
  return seen;
}

describe("moderation actions", () => {
  it.each([
    ["hideToken", () => moderation.hideToken("sepolia", T), `/sepolia/admin/tokens/${T}/hide`],
    ["hideComment", () => moderation.hideComment("sepolia", "42"), "/sepolia/admin/comments/42/hide"],
    ["banUser", () => moderation.banUser("sepolia", T), `/sepolia/admin/users/${T}/ban`],
  ])("%s posts JSON to the right path, with the session cookie", async (_name, act, path) => {
    const seen = capture(path);
    await act();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", type: "application/json", credentials: "include", body: {} });
  });

  it("encodes what goes into a path", async () => {
    const seen = capture("/sepolia/admin/tokens/:address/hide");
    await moderation.hideToken("sepolia", "0xa b/c");
    expect(seen[0]!.url.pathname).toBe("/sepolia/admin/tokens/0xa%20b%2Fc/hide");
  });

  it("reports a token with the reason and nothing else", async () => {
    const seen = capture(`/sepolia/tokens/${T}/report`, { status: 201, body: { id: "1" } });
    expect(await moderation.report("sepolia", T, "it is a scam")).toEqual({ alreadyReported: false });
    expect(seen[0]).toMatchObject({ type: "application/json", credentials: "include", body: { reason: "it is a scam" } });
  });

  it("says when a report was already open", async () => {
    capture(`/sepolia/tokens/${T}/report`, { status: 200, body: { alreadyReported: true } });
    expect(await moderation.report("sepolia", T, "again")).toEqual({ alreadyReported: true });
  });

  it.each([
    [404, "not_found"],
    [429, "rate_limited"],
    [400, "bad_reason"],
    [401, "unauthenticated"],
  ])("turns a %s into an ApiError carrying the code %s", async (status, code) => {
    capture(`/sepolia/tokens/${T}/report`, { status, body: { error: code, message: "m" } });
    await expect(moderation.report("sepolia", T, "x")).rejects.toMatchObject({ name: "ApiError", status, code });
  });

  it("reports an unreachable server as a network error", async () => {
    server.use(http.post(`${API}/sepolia/admin/tokens/:address/hide`, () => HttpResponse.error()));
    await expect(moderation.hideToken("sepolia", T)).rejects.toMatchObject({ code: "network", status: 0 });
  });
});

describe("the admin page's reads", () => {
  const wireHealth = (o: Record<string, unknown> = {}) => ({
    indexerLagBlocks: 3,
    watcherAliveSince: "1700000000",
    botAddress: ADDR(0xb07),
    botBalance: "1500000000000000000",
    failedMetadataCount: 2,
    stuckTokens: [{ address: T, name: "Full", ticker: "FULL", completeSince: "1700000100" }],
    ...o,
  });

  it("reads the health with the times and the balance as bigint, and unknowns as null", async () => {
    server.use(http.get(`${API}/sepolia/admin/health`, () => HttpResponse.json(wireHealth({ indexerLagBlocks: null, botBalance: null }))));
    expect(await moderation.health("sepolia")).toEqual({
      indexerLagBlocks: null,
      watcherAliveSince: 1_700_000_000n,
      botAddress: ADDR(0xb07),
      botBalance: null,
      failedMetadataCount: 2,
      stuckTokens: [{ address: T, name: "Full", ticker: "FULL", completeSince: 1_700_000_100n }],
    });
  });

  it("asks with the session cookie, and does not trust a balance that is not a whole number", async () => {
    let credentials = "";
    server.use(http.get(`${API}/sepolia/admin/health`, ({ request }) => ((credentials = request.credentials), HttpResponse.json(wireHealth({ botBalance: "1e18" })))));
    await expect(moderation.health("sepolia")).rejects.toMatchObject({ code: "bad_response" });
    expect(credentials).toBe("include");
  });

  it("reads the report queue", async () => {
    server.use(
      http.get(`${API}/sepolia/admin/reports`, () =>
        HttpResponse.json({ items: [{ id: "4", token: T, name: "Spam", ticker: "SPM", reporter: ADDR(0xa1), reason: "<b>scam</b>", createdAt: "1700000000", hidden: false }] }),
      ),
    );
    expect(await moderation.reports("sepolia")).toEqual({
      items: [{ id: "4", token: T, name: "Spam", ticker: "SPM", reporter: ADDR(0xa1), reason: "<b>scam</b>", createdAt: 1_700_000_000n, hidden: false }],
    });
  });

  it("refuses to read for a non-admin: the API's 404 comes through as an error carrying its code", async () => {
    server.use(http.get(`${API}/sepolia/admin/health`, () => HttpResponse.json({ error: "not_found", message: "Not found." }, { status: 404 })));
    await expect(moderation.health("sepolia")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("settles a report and retries failed metadata, by JSON POST", async () => {
    const seen = capture("/sepolia/admin/reports/9/resolve");
    await moderation.resolveReport("sepolia", "9");
    expect(seen[0]).toMatchObject({ method: "POST", type: "application/json", credentials: "include" });
    capture("/sepolia/admin/metadata/re-resolve", { body: { count: 3 } });
    expect(await moderation.reResolveMetadata("sepolia")).toEqual({ count: 3 });
  });
});
