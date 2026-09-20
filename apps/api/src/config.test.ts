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

  it("takes the website's origin for sign-in, defaulting to the local dev server, and rejects anything that is not an origin", () => {
    expect(loadConfig(base).webOrigin).toBe("http://localhost:3000");
    expect(loadConfig({ ...base, WEB_ORIGIN: "https://launchpad.example.com/" }).webOrigin).toBe("https://launchpad.example.com");
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "javascript:alert(1)" })).toThrow(/WEB_ORIGIN/);
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "not a url" })).toThrow(/WEB_ORIGIN/);
    expect(() => loadConfig({ ...base, WEB_ORIGIN: "https://launchpad.example.com/some/path" })).toThrow(/WEB_ORIGIN/);
  });

  it("trusts a proxy's client address only when told to", () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "true" }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: "false" }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "yes please" })).toThrow(/TRUST_PROXY/);
  });

  it("has an RPC url only when one is given, and it must be http(s)", () => {
    expect(loadConfig(base).rpcUrl).toBeUndefined();
    expect(loadConfig({ ...base, RPC_URL: "https://rpc.example" }).rpcUrl).toBe("https://rpc.example");
    expect(() => loadConfig({ ...base, RPC_URL: "ftp://rpc.example" })).toThrow(/RPC_URL/);
  });

  it("has no pinning service unless one is configured: uploads then say they are unavailable", () => {
    const c = loadConfig(base);
    expect(c.pinner).toBeUndefined();
    expect(c.pinataJwt).toBeUndefined();
  });

  it("pins through Pinata when a key is given, and never puts the key in the config's printed form", () => {
    const c = loadConfig({ ...base, PINATA_JWT: "very-secret" });
    expect(c.pinner).toBe("pinata");
    expect(c.pinataJwt).toBe("very-secret");
  });

  it("allows the fake pinner for development and refuses it in production", () => {
    expect(loadConfig({ ...base, PINNER: "fake" }).pinner).toBe("fake");
    expect(() => loadConfig({ ...base, PINNER: "fake", NODE_ENV: "production" })).toThrow(/PINNER/);
  });

  it("refuses a PINNER it does not know", () => {
    expect(() => loadConfig({ ...base, PINNER: "ipfs-magic" })).toThrow(/PINNER/);
  });
});
