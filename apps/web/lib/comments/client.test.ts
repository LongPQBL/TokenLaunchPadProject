import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ADDR, wireComment } from "../../test/msw/fixtures";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createCommentsApi } from "./client";

const comments = createCommentsApi({ baseUrl: API });
const T = ADDR(0xa1);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("posting a comment", () => {
  it("sends the text as JSON with the session cookie, and returns the saved comment", async () => {
    let seen: { body: unknown; type: string | null; credentials: string } | undefined;
    server.use(
      http.post(`${API}/sepolia/tokens/:address/comments`, async ({ request }) => {
        seen = { body: await request.json(), type: request.headers.get("content-type"), credentials: request.credentials };
        return HttpResponse.json(wireComment({ id: "42", body: "hello" }), { status: 201 });
      }),
    );
    const saved = await comments.post("sepolia", T, "hello");
    expect(seen).toEqual({ body: { body: "hello" }, type: "application/json", credentials: "include" });
    expect(saved).toEqual({ id: "42", author: ADDR(0xc0de), body: "hello", createdAt: 1_700_000_000n });
  });

  it("sends nothing but the text: who is speaking is the session's business", async () => {
    let body: unknown;
    server.use(
      http.post(
        `${API}/sepolia/tokens/:address/comments`,
        async ({ request }) => ((body = await request.json()), HttpResponse.json(wireComment(), { status: 201 })),
      ),
    );
    await comments.post("sepolia", T, "x");
    expect(Object.keys(body as object)).toEqual(["body"]);
  });

  it("puts the token in the path, encoded", async () => {
    const seen: URL[] = [];
    server.use(
      http.post(
        `${API}/sepolia/tokens/:address/comments`,
        ({ request }) => (seen.push(new URL(request.url)), HttpResponse.json(wireComment(), { status: 201 })),
      ),
    );
    await comments.post("sepolia", "0xa b/c", "x");
    expect(seen[0]!.pathname).toBe("/sepolia/tokens/0xa%20b%2Fc/comments");
  });

  it.each([
    [401, "unauthenticated"],
    [403, "banned"],
    [429, "rate_limited"],
    [400, "bad_comment"],
    [404, "not_found"],
  ])("turns a %s into an error carrying the API's code %s", async (status, code) => {
    server.use(http.post(`${API}/sepolia/tokens/:address/comments`, () => HttpResponse.json({ error: code, message: "m" }, { status })));
    await expect(comments.post("sepolia", T, "x")).rejects.toMatchObject({ name: "ApiError", status, code });
  });

  it("reports an unreachable server as a network error, and a non-JSON failure page as load_failed", async () => {
    server.use(http.post(`${API}/sepolia/tokens/:address/comments`, () => HttpResponse.error()));
    await expect(comments.post("sepolia", T, "x")).rejects.toMatchObject({ code: "network", status: 0 });
    server.use(http.post(`${API}/sepolia/tokens/:address/comments`, () => new HttpResponse("<html>bad gateway</html>", { status: 502 })));
    await expect(comments.post("sepolia", T, "x")).rejects.toMatchObject({ code: "load_failed", status: 502 });
  });

  it("does not trust a reply that is not a comment", async () => {
    server.use(http.post(`${API}/sepolia/tokens/:address/comments`, () => HttpResponse.json({ ok: true }, { status: 201 })));
    await expect(comments.post("sepolia", T, "x")).rejects.toMatchObject({ code: "bad_response" });
  });
});
