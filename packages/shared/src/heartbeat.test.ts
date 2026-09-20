import { describe, expect, it } from "vitest";
import { HEARTBEAT_TTL_SECONDS, heartbeatKey, parseHeartbeat } from "./heartbeat";

describe("heartbeatKey", () => {
  it("names one key per chain, so two deployments never read each other's", () => {
    expect(heartbeatKey("sepolia")).toBe("bot:heartbeat:sepolia");
    expect(heartbeatKey("sepolia")).not.toBe(heartbeatKey("mainnet"));
  });

  it("lives longer than three beats: one missed beat is not an outage", () => {
    expect(HEARTBEAT_TTL_SECONDS).toBeGreaterThanOrEqual(30);
  });
});

describe("parseHeartbeat", () => {
  const good = { since: "1700000000", at: "1700000100", address: "0x00000000000000000000000000000000000000b1", balance: "123456789012345678901" };

  it("reads what the bot writes", () => {
    expect(parseHeartbeat(JSON.stringify(good))).toEqual(good);
  });

  it("keeps a heartbeat that has no balance (the bot could not read it) and drops a balance that is not a whole number", () => {
    expect(parseHeartbeat(JSON.stringify({ ...good, balance: undefined }))).toEqual({ since: good.since, at: good.at, address: good.address });
    expect(parseHeartbeat(JSON.stringify({ ...good, balance: "1e18" }))?.balance).toBeUndefined();
    expect(parseHeartbeat(JSON.stringify({ ...good, balance: 5 }))?.balance).toBeUndefined();
  });

  it("is nothing for what is not a heartbeat: no time, junk times, not JSON, not an object, absent", () => {
    for (const bad of [null, undefined, "", "not json", "5", "[]", JSON.stringify({ at: "1" }), JSON.stringify({ since: "x", at: "1" }), JSON.stringify({ since: "1", at: "-1" })]) {
      expect(parseHeartbeat(bad as never), String(bad)).toBeUndefined();
    }
  });

  it("does not pass on an address that is not one", () => {
    expect(parseHeartbeat(JSON.stringify({ ...good, address: "<script>" }))?.address).toBeUndefined();
  });
});
