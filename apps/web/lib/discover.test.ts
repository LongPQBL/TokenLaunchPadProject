import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { wireToken } from "../test/msw/fixtures";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { createApi } from "./api";
import { discoverHref, loadDiscover, parseSort } from "./discover";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("parseSort", () => {
  it("accepts the three sorts", () => {
    for (const sort of ["new", "volume", "progress"] as const) expect(parseSort(sort)).toBe(sort);
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
