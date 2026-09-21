import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../api";
import { ADDR, wireToken } from "../../test/msw/fixtures";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createFavoritesApi } from "./client";

const favorites = createFavoritesApi({ baseUrl: API });
const T = ADDR(0xa1);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("the favorites client", () => {
  it("lists the starred tokens, carrying the session cookie", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/sepolia/me/favorites`, ({ request }) => {
        seen.push(request.credentials);
        return HttpResponse.json({ tokens: [T, ADDR(0xb2)] });
      }),
    );
    expect(await favorites.list("sepolia")).toEqual([T, ADDR(0xb2)]);
    expect(seen).toEqual(["include"]);
  });

  it("reads the watchlist as table rows, numbers turned into bigints once, carrying the session cookie", async () => {
    const seen: string[] = [];
    const stats = { marketCap: "5000000000000000000", athMarketCap: "10000000000000000000", volume24h: "1", traders24h: 2, change1hBps: -5, change6hBps: 0, change24hBps: 7 };
    server.use(
      http.get(`${API}/sepolia/me/watchlist`, ({ request }) => {
        seen.push(request.credentials);
        return HttpResponse.json({ items: [wireToken({ stats })] });
      }),
    );
    const [row] = await favorites.watchlist("sepolia");
    expect(seen).toEqual(["include"]);
    expect(row!.stats).toMatchObject({ marketCap: 5n * 10n ** 18n, traders24h: 2, change1hBps: -5 });
  });

  it("does not believe a watchlist whose rows are not rows", async () => {
    server.use(http.get(`${API}/sepolia/me/watchlist`, () => HttpResponse.json({ items: [{ address: 1 }] })));
    await expect(favorites.watchlist("sepolia")).rejects.toMatchObject({ code: "bad_response" });
  });

  it("stars with PUT and unstars with DELETE, on the token's path", async () => {
    const seen: string[] = [];
    server.use(
      http.put(`${API}/sepolia/me/favorites/${T}`, ({ request }) => (seen.push(`${request.method} ${request.credentials}`), HttpResponse.json({ token: T, starred: true }))),
      http.delete(`${API}/sepolia/me/favorites/${T}`, ({ request }) => (seen.push(`${request.method} ${request.credentials}`), HttpResponse.json({ token: T, starred: false }))),
    );
    await favorites.star("sepolia", T);
    await favorites.unstar("sepolia", T);
    expect(seen).toEqual(["PUT include", "DELETE include"]);
  });

  it("throws what the API refused with, as an error that carries its code", async () => {
    server.use(http.put(`${API}/sepolia/me/favorites/${T}`, () => HttpResponse.json({ error: "too_many", message: "x" }, { status: 409 })));
    await expect(favorites.star("sepolia", T)).rejects.toMatchObject({ code: "too_many", status: 409 });
  });

  it("says there is no session as an ApiError with 401, so the page can ask to log in", async () => {
    server.use(http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })));
    const error = await favorites.list("sepolia").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  it("does not believe a list that is not a list of addresses", async () => {
    server.use(http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.json({ tokens: ["nope"] })));
    await expect(favorites.list("sepolia")).rejects.toMatchObject({ code: "bad_response" });
  });

  it("reports a server it could not reach as a network error", async () => {
    server.use(http.get(`${API}/sepolia/me/favorites`, () => HttpResponse.error()));
    await expect(favorites.list("sepolia")).rejects.toMatchObject({ code: "network" });
  });

  it("puts nothing from the caller into the path unescaped", async () => {
    server.use(http.put(`${API}/sepolia/me/favorites/:token`, ({ params }) => HttpResponse.json({ token: String(params.token), starred: true })));
    await expect(favorites.star("sepolia", "a/../b")).resolves.toBeUndefined();
  });
});
