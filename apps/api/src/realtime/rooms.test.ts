import { describe, expect, it } from "vitest";
import { parseRoom, ROOMS_PER_SOCKET } from "./rooms.js";

const ADDR = "0x00000000000000000000000000000000000000B2";
const chains = ["sepolia"];

describe("parseRoom", () => {
  it("accepts the two global rooms", () => {
    expect(parseRoom("tokens", chains)).toBe("tokens");
    expect(parseRoom("trades", chains)).toBe("trades");
  });

  it("accepts a token's room and lower-cases the address, so any capitalisation joins the same room", () => {
    expect(parseRoom(`token:sepolia:${ADDR}`, chains)).toBe(`token:sepolia:${ADDR.toLowerCase()}`);
    expect(parseRoom(`token:sepolia:${ADDR.toLowerCase()}`, chains)).toBe(`token:sepolia:${ADDR.toLowerCase()}`);
  });

  it("refuses everything else: another chain, a bad address, a made-up room, a wildcard, non-strings", () => {
    const bad = [
      `token:mainnet:${ADDR}`,
      "token:sepolia:0x123",
      `token:sepolia:${ADDR}:extra`,
      `token:sepolia:${ADDR}\n`,
      "token:sepolia:",
      "admin",
      "*",
      "token:*",
      "Trades",
      " trades",
      "",
      "constructor",
      "__proto__",
      `token:constructor:${ADDR}`,
    ];
    for (const name of bad) expect(parseRoom(name, chains), JSON.stringify(name)).toBeUndefined();
    for (const notAString of [undefined, null, 5, {}, [], ["trades"]]) expect(parseRoom(notAString, chains)).toBeUndefined();
  });

  it("caps how many rooms one connection may hold", () => {
    expect(ROOMS_PER_SOCKET).toBeGreaterThanOrEqual(10);
    expect(ROOMS_PER_SOCKET).toBeLessThanOrEqual(100);
  });
});
