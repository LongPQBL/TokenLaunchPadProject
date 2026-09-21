import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createApi } from "../api";
import { listCandidateTokens, rememberedTokens, rememberToken } from "./holdings";

const MAIN = "0x00000000000000000000000000000000000000a1";
const SESSION = "0x00000000000000000000000000000000000000c1";
const T1 = "0x00000000000000000000000000000000000000b1";
const T2 = "0x00000000000000000000000000000000000000b2";
const T3 = "0x00000000000000000000000000000000000000b3";
const api = createApi({ baseUrl: API });

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => localStorage.clear());

const holdings = (tokens: string[]) =>
  server.use(http.get(`${API}/sepolia/addresses/:address/holdings`, () => HttpResponse.json({ items: tokens.map((token) => ({ token, amount: "5" })) })));

describe("remembered tokens", () => {
  it("remembers a token per main wallet, once", () => {
    rememberToken(MAIN, T1);
    rememberToken(MAIN, T1.toUpperCase().replace("0X", "0x"));
    rememberToken("0x00000000000000000000000000000000000000a2", T2);
    expect(rememberedTokens(MAIN)).toEqual([T1]);
  });

  it("never throws when storage is unavailable", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => rememberToken(MAIN, T1)).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("stays bounded", () => {
    for (let i = 0; i < 600; i++) rememberToken(MAIN, `0x${i.toString(16).padStart(40, "0")}`);
    expect(rememberedTokens(MAIN).length).toBeLessThanOrEqual(500);
  });
});

describe("listCandidateTokens", () => {
  it("joins what the index says with what this browser remembers trading, so a token bought a moment ago is not missed", async () => {
    holdings([T1, T2]);
    rememberToken(MAIN, T3);
    const list = await listCandidateTokens({ api, chain: "sepolia", sessionAddress: SESSION, main: MAIN });
    expect(new Set(list.map((t) => t.toLowerCase()))).toEqual(new Set([T1, T2, T3]));
  });

  it("does not list a token twice", async () => {
    holdings([T1]);
    rememberToken(MAIN, T1);
    expect(await listCandidateTokens({ api, chain: "sepolia", sessionAddress: SESSION, main: MAIN })).toHaveLength(1);
  });

  it("still works from memory when the index is down: an outage must not strand funds", async () => {
    server.use(http.get(`${API}/sepolia/addresses/:address/holdings`, () => new HttpResponse("down", { status: 503 })));
    rememberToken(MAIN, T3);
    expect(await listCandidateTokens({ api, chain: "sepolia", sessionAddress: SESSION, main: MAIN })).toEqual([T3]);
  });

  it("asks the index about the SESSION wallet, not the main one", async () => {
    let asked = "";
    server.use(http.get(`${API}/sepolia/addresses/:address/holdings`, ({ params }) => ((asked = String(params.address)), HttpResponse.json({ items: [] }))));
    await listCandidateTokens({ api, chain: "sepolia", sessionAddress: SESSION, main: MAIN });
    expect(asked).toBe(SESSION);
  });
});
