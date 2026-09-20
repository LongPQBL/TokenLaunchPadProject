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
