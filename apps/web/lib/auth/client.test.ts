import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { ApiError } from "../api";
import { createAuthApi } from "./client";

const auth = createAuthApi({ baseUrl: API });
const ADDRESS = "0x00000000000000000000000000000000000000a1";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("createAuthApi", () => {
  it("asks for a challenge for an address, sending the cookie along", async () => {
    let seen: Request | undefined;
    server.use(
      http.get(`${API}/auth/nonce`, ({ request }) => {
        seen = request;
        return HttpResponse.json({ message: "m", nonce: "n" });
      }),
    );
    expect(await auth.nonce(ADDRESS)).toEqual({ message: "m", nonce: "n" });
    expect(new URL(seen!.url).searchParams.get("address")).toBe(ADDRESS);
    expect(seen!.credentials).toBe("include");
  });

  it("posts the signed message as JSON", async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/auth/verify`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ address: ADDRESS });
      }),
    );
    expect(await auth.verify("the message", "0xabcd")).toEqual({ address: ADDRESS });
    expect(body).toEqual({ message: "the message", signature: "0xabcd" });
  });

  it("turns a refused sign-in into an ApiError carrying the server's code", async () => {
    server.use(http.post(`${API}/auth/verify`, () => HttpResponse.json({ error: "invalid_signin", message: "nope" }, { status: 401 })));
    await expect(auth.verify("m", "0x12")).rejects.toMatchObject({ name: "ApiError", status: 401, code: "invalid_signin" });
  });

  it("says who is signed in, or nobody: a missing session is an answer, not a failure", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ address: ADDRESS })));
    expect(await auth.me()).toBe(ADDRESS);
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })));
    expect(await auth.me()).toBeUndefined();
  });

  it("still fails for a server error on /me", async () => {
    server.use(http.get(`${API}/me`, () => new HttpResponse("oops", { status: 500 })));
    await expect(auth.me()).rejects.toBeInstanceOf(ApiError);
  });

  it("does not trust a /me answer that is not an address", async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ address: "javascript:alert(1)" })));
    await expect(auth.me()).rejects.toMatchObject({ code: "bad_response" });
  });

  it("logs out with a POST", async () => {
    let method = "";
    server.use(
      http.post(`${API}/auth/logout`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true });
      }),
    );
    await auth.logout();
    expect(method).toBe("POST");
  });

  it("reports an unreachable server as a network error", async () => {
    server.use(http.get(`${API}/auth/nonce`, () => HttpResponse.error()));
    await expect(auth.nonce(ADDRESS)).rejects.toMatchObject({ code: "network" });
  });
});
