import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wireToken } from "../test/msw/fixtures";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { createApi } from "./api";
import { discoverHref, loadDiscover, parseSort, parseView } from "./discover";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("parseSort", () => {
  it("accepts every sort the API has", () => {
    for (const sort of ["new", "volume", "progress", "mcap", "txns", "volume24h", "traders", "change1h", "change6h", "change24h"] as const) expect(parseSort(sort)).toBe(sort);
  });

  // The value is straight from the URL, and Next hands back an array for a repeated key.
  it("falls back to new for anything else", () => {
    for (const bad of [undefined, "", "price", "NEW", "volume;drop", "__proto__", "constructor"]) {
      expect(parseSort(bad), String(bad)).toBe("new");
    }
  });

  it("uses the first value when a key is repeated", () => {
    expect(parseSort(["progress", "new"])).toBe("progress");
  });
});

describe("parseView", () => {
  it("is the table unless the URL says grid, and nothing else from the URL is believed", () => {
    expect(parseView(undefined)).toBe("table");
    expect(parseView("grid")).toBe("grid");
    expect(parseView(["grid", "table"])).toBe("grid");
    for (const bad of ["", "list", "GRID", "grid;x", "__proto__"]) expect(parseView(bad), bad).toBe("table");
  });
});

describe("discoverHref and the view", () => {
  it("leaves the table out of the URL (it is the default) and puts the grid in", () => {
    expect(discoverHref("sepolia", { view: "table" })).toBe("/sepolia");
    expect(discoverHref("sepolia", { view: "grid" })).toBe("/sepolia?view=grid");
    expect(discoverHref("sepolia", { sort: "mcap", q: "dog", view: "grid" })).toBe("/sepolia?sort=mcap&q=dog&view=grid");
  });
});

describe("discoverHref", () => {
  it("leaves out everything that is a default, so the plain page has the plain URL", () => {
    expect(discoverHref("sepolia", {})).toBe("/sepolia");
    expect(discoverHref("sepolia", { sort: "new" })).toBe("/sepolia");
  });

  it("carries the sort, the search and the cursor, encoded", () => {
    expect(discoverHref("sepolia", { sort: "volume" })).toBe("/sepolia?sort=volume");
    expect(discoverHref("sepolia", { sort: "volume", q: "dog e&x" })).toBe("/sepolia?sort=volume&q=dog+e%26x");
    expect(discoverHref("sepolia", { cursor: "abc_-" })).toBe("/sepolia?cursor=abc_-");
  });

  it("omits a blank search", () => {
    expect(discoverHref("sepolia", { q: "   " })).toBe("/sepolia");
  });
});

describe("loadDiscover", () => {
  const api = createApi({ baseUrl: API });

  it("reads the numbers of a row into bigints and numbers once, at the edge, and passes the view along", async () => {
    const stats = { marketCap: "5000000000000000000", athMarketCap: "10000000000000000000", volume24h: "1500000000000000000", traders24h: 1905, change1hBps: 8870, change6hBps: 632070, change24hBps: -3110 };
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ items: [wireToken({ stats })] })));
    const { page, view } = await loadDiscover(api, "sepolia", { view: "grid" });
    expect(page.items[0]!.stats).toEqual({ ...stats, marketCap: 5n * 10n ** 18n, athMarketCap: 10n * 10n ** 18n, volume24h: 15n * 10n ** 17n });
    expect(view).toBe("grid");
  });

  it("does not believe a row whose numbers are not numbers", async () => {
    const stats = { marketCap: "lots", athMarketCap: "1", volume24h: "1", traders24h: 1, change1hBps: 1, change6hBps: 1, change24hBps: 1 };
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ items: [wireToken({ stats })] })));
    await expect(loadDiscover(api, "sepolia", {})).rejects.toThrow();
  });

  it("asks the API for the parsed sort and the trimmed search, and returns the page", async () => {
    let seen: URL | undefined;
    server.use(
      http.get(`${API}/sepolia/tokens`, ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({ items: [wireToken()], nextCursor: "n" });
      }),
    );
    const result = await loadDiscover(api, "sepolia", { sort: "volume", q: "  dog  ", cursor: "c1" });
    expect(seen!.searchParams.get("sort")).toBe("volume");
    expect(seen!.searchParams.get("q")).toBe("dog");
    expect(seen!.searchParams.get("cursor")).toBe("c1");
    expect(result).toMatchObject({ sort: "volume", q: "dog", page: { nextCursor: "n" } });
    expect(result.page.items).toHaveLength(1);
  });

  it("defaults to newest first with no search", async () => {
    const result = await loadDiscover(api, "sepolia", {});
    expect(result).toMatchObject({ sort: "new", q: "" });
  });
});
