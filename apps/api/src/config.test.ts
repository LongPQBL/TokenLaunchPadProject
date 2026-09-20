import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgresql://u@localhost:5432/db" };

describe("loadConfig", () => {
  it("parses a comma-separated CORS list, trimming and dropping blanks", () => {
    const c = loadConfig({ ...base, CORS_ORIGINS: " https://a.example , ,https://b.example," });
    expect(c.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
  });

  it("defaults to no allowed origins and port 3001", () => {
    const c = loadConfig(base);
    expect(c.corsOrigins).toEqual([]);
    expect(c.port).toBe(3001);
  });

  // Spec §5: cookies are in play, so a wildcard origin is refused outright rather than honoured.
  it("refuses a wildcard origin", () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "*" })).toThrow(/wildcard|\*/i);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "https://a.example,*" })).toThrow();
  });

  it("defaults the IPFS gateway, and trims a trailing slash from one that is given", () => {
    expect(loadConfig(base).ipfsGatewayUrl).toBe("https://ipfs.io");
    expect(loadConfig({ ...base, IPFS_GATEWAY_URL: "https://my.gateway.example///" }).ipfsGatewayUrl).toBe("https://my.gateway.example");
  });

  // The gateway is the ONE host the metadata resolver may contact, so it must be a real http(s) URL.
  it("refuses a gateway that is not an http(s) URL", () => {
    for (const bad of ["not a url", "ftp://gw.example", "file:///etc", "javascript:alert(1)", ""]) {
      expect(() => loadConfig({ ...base, IPFS_GATEWAY_URL: bad }), bad).toThrow(/IPFS_GATEWAY_URL/);
    }
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(/PORT/);
  });
});
