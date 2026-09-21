import { describe, expect, it } from "vitest";
import { liveCommentsHiddenSchema, liveTokenHiddenSchema } from "./moderation";

const TOKEN = "0x00000000000000000000000000000000000000B1";

describe("token_hidden from the wire", () => {
  it("is accepted, with the token in lower case", () => {
    const parsed = liveTokenHiddenSchema.parse({ type: "token_hidden", chain: "sepolia", token: TOKEN });
    expect(parsed).toEqual({ type: "token_hidden", chain: "sepolia", token: TOKEN.toLowerCase() });
  });

  it("is refused when it is not one: another type, a bad address, or nothing", () => {
    for (const bad of [{ type: "trade", chain: "sepolia", token: TOKEN }, { type: "token_hidden", chain: "sepolia", token: "0x12" }, { type: "token_hidden", token: TOKEN }, null, "x"]) {
      expect(liveTokenHiddenSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("comments_hidden from the wire", () => {
  it("is accepted, with the token in lower case and the ids as text", () => {
    const parsed = liveCommentsHiddenSchema.parse({ type: "comments_hidden", chain: "sepolia", token: TOKEN, ids: ["4", "19"] });
    expect(parsed).toEqual({ type: "comments_hidden", chain: "sepolia", token: TOKEN.toLowerCase(), ids: ["4", "19"] });
  });

  it("is refused for ids that are not numbers, no ids at all, or an absurd number of them", () => {
    const base = { type: "comments_hidden", chain: "sepolia", token: TOKEN };
    for (const ids of [["x"], ["1e3"], [4], [], Array.from({ length: 1_001 }, (_, i) => String(i))]) {
      expect(liveCommentsHiddenSchema.safeParse({ ...base, ids }).success, JSON.stringify(ids).slice(0, 30)).toBe(false);
    }
  });
});
