import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ADDR, wireCandle, wireDetail, wireHolder, wireToken, wireTrade } from "../test/msw/fixtures";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { ApiError, createApi } from "./api";

const api = createApi({ baseUrl: API });
const T = ADDR(0xa1);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Runs a request against a handler that records the URL it was called with. */
function capture(path: string, body: unknown = { items: [] }) {
  const seen: URL[] = [];
  server.use(
    http.get(`${API}${path}`, ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json(body as never);
    }),
  );
  return seen;
}

describe("amounts cross the boundary as bigint", () => {
  it("turns a uint256-sized string into an exact bigint, never a rounded number", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ items: [wireToken({ volumeQuote: "1000000000000000000000000001" })] })));
    const { items } = await api.tokens("sepolia");
    expect(items[0]!.volumeQuote).toBe(1_000_000_000_000_000_000_000_000_001n);
    expect(items[0]!.createdAt).toBe(1_700_000_000n);
    expect(typeof items[0]!.progressBps).toBe("number");
  });

  it("does the same for token detail, trades and holders", async () => {
    const detail = await api.token("sepolia", T);
    expect(detail.virtualTokenReserves).toBe(1_066_666_666_666_666_666_666_666_666n);
    const { items: trades } = await api.trades("sepolia", T);
    expect(trades[0]).toMatchObject({ quoteAmount: 1_000_000_000_000_000n, launchTax: 0n, blockNumber: 11_743_550n, logIndex: 3 });
    const { items: holders } = await api.holders("sepolia", T);
    expect(holders[0]!.amount).toBe(40_000_000_000_000_000_000_000_000n);
  });

  it("keeps candle prices as decimal strings, because they carry a fraction, and volume as bigint", async () => {
    const { items } = await api.candles("sepolia", T, 60);
    expect(items[0]!.open).toBe("15654338.125289299030");
    expect(items[0]!.volume).toBe(50_015_646_996_713_005n);
    expect(items[0]!.time).toBe(1_700_000_040);
  });

  it("carries the optional fields through and leaves absent ones undefined", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ items: [wireToken({ imageUrl: "https://cdn/x.png" }), wireToken({ name: undefined, description: undefined })] })));
    const { items } = await api.tokens("sepolia");
    expect(items[0]!.imageUrl).toBe("https://cdn/x.png");
    expect(items[1]!.name).toBeUndefined();
  });

  it("ignores fields it does not know, so the API can add some without breaking the app", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ items: [wireToken({ somethingNew: 1 })] })));
    await expect(api.tokens("sepolia")).resolves.toBeDefined();
  });
});

describe("requests", () => {
  it("puts the chain slug in the path", async () => {
    const seen = capture("/sepolia/tokens");
    await api.tokens("sepolia");
    expect(seen[0]!.pathname).toBe("/sepolia/tokens");
  });

  it("sends only the options that were given", async () => {
    const seen = capture("/sepolia/tokens");
    await api.tokens("sepolia", { sort: "volume", limit: 20 });
    expect(seen[0]!.searchParams.get("sort")).toBe("volume");
    expect(seen[0]!.searchParams.get("limit")).toBe("20");
    expect(seen[0]!.searchParams.has("q")).toBe(false);
    expect(seen[0]!.searchParams.has("cursor")).toBe(false);
  });

  // A user who clears the search box leaves q as "", which must not be sent as a filter.
  it("treats an empty search box or cursor as absent rather than sending q= or cursor=", async () => {
    const seen = capture("/sepolia/tokens");
    await api.tokens("sepolia", { q: "", cursor: "" });
    expect([...seen[0]!.searchParams.keys()]).toEqual([]);
  });

  it("encodes search text, so a user typing & or # cannot change the query", async () => {
    const seen = capture("/sepolia/tokens");
    await api.tokens("sepolia", { q: "a b&c=d#e" });
    expect(seen[0]!.searchParams.get("q")).toBe("a b&c=d#e");
    expect([...seen[0]!.searchParams.keys()]).toEqual(["q"]);
  });

  it("encodes the chain and address segments as path segments", async () => {
    const seen = capture("/:chain/tokens/:address/trades");
    await api.trades("sepolia", T, { cursor: "abc_-", limit: 5 });
    expect(seen[0]!.pathname).toBe(`/sepolia/tokens/${T}/trades`);
    expect(seen[0]!.searchParams.get("cursor")).toBe("abc_-");
  });

  it("asks for candles by interval in seconds", async () => {
    const seen = capture("/:chain/tokens/:address/candles");
    await api.candles("sepolia", T, 300);
    expect(seen[0]!.searchParams.get("interval")).toBe("300");
  });

  it("returns the cursor so the caller can ask for the next page", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ items: [wireToken()], nextCursor: "next-page" })));
    expect((await api.tokens("sepolia")).nextCursor).toBe("next-page");
  });
});

describe("errors", () => {
  const status = (code: number, body: unknown) =>
    server.use(http.get(`${API}/sepolia/tokens/:address`, () => HttpResponse.json(body as never, { status: code })));

  it("turns a 404 into an ApiError carrying the machine code", async () => {
    status(404, { error: "not_found", message: "Token not found." });
    const e = await api.token("sepolia", T).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 404, code: "not_found" });
  });

  it("carries a 400's code, for example a bad cursor", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json({ error: "bad_cursor", message: "Malformed cursor." }, { status: 400 })));
    expect(await api.tokens("sepolia", { cursor: "x" }).catch((x) => x)).toMatchObject({ status: 400, code: "bad_cursor" });
  });

  it("reports a 500 with a non-JSON body as load_failed rather than a JSON parse error", async () => {
    server.use(http.get(`${API}/sepolia/tokens/:address`, () => new HttpResponse("<html>Bad Gateway</html>", { status: 502 })));
    expect(await api.token("sepolia", T).catch((x) => x)).toMatchObject({ status: 502, code: "load_failed" });
  });

  it("reports a network failure as an ApiError with code network", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.error()));
    expect(await api.tokens("sepolia").catch((x) => x)).toMatchObject({ code: "network" });
  });

  // A response that does not match the schema must fail loudly here, not surface as NaN or a thrown BigInt deep in a component.
  it("rejects a malformed response with bad_response", async () => {
    for (const bad of [
      { items: [wireToken({ volumeQuote: "1e18" })] },
      { items: [wireToken({ volumeQuote: "-5" })] },
      { items: [wireToken({ volumeQuote: 5 })] },
      { items: [wireToken({ progressBps: "78" })] },
      { items: "not a list" },
      {},
    ]) {
      server.use(http.get(`${API}/sepolia/tokens`, () => HttpResponse.json(bad as never)));
      expect(await api.tokens("sepolia").catch((x) => x), JSON.stringify(bad).slice(0, 50)).toMatchObject({ code: "bad_response" });
    }
  });

  it("lets an aborted request reject as an AbortError so the caller can tell it from a failure", async () => {
    server.use(http.get(`${API}/sepolia/tokens`, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return HttpResponse.json({ items: [] });
    }));
    const controller = new AbortController();
    const pending = api.tokens("sepolia", { signal: controller.signal }).catch((x) => x);
    controller.abort();
    expect(await pending).toMatchObject({ name: "AbortError" });
  });
});

describe("token detail", () => {
  it("returns the metadata status and the social links", async () => {
    server.use(http.get(`${API}/sepolia/tokens/:address`, () => HttpResponse.json(wireDetail({ metadataStatus: "pending", socials: {} }))));
    expect(await api.token("sepolia", T)).toMatchObject({ metadataStatus: "pending", socials: {}, antiSniperWindow: 60 });
  });

  it("reads a trade and a holder list end to end", async () => {
    server.use(
      http.get(`${API}/sepolia/tokens/:address/trades`, () => HttpResponse.json({ items: [wireTrade(), wireTrade({ isBuy: false, id: "x-1" })] })),
      http.get(`${API}/sepolia/tokens/:address/holders`, () => HttpResponse.json({ items: [wireHolder(), wireHolder({ holder: ADDR(2) })] })),
    );
    expect((await api.trades("sepolia", T)).items.map((t) => t.isBuy)).toEqual([true, false]);
    expect((await api.holders("sepolia", T)).items).toHaveLength(2);
  });
});
