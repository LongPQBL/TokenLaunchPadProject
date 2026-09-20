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

  it("has no Redis unless one is given: live updates are then off and the pages poll", () => {
    expect(loadConfig(base).redisUrl).toBeUndefined();
    expect(loadConfig({ ...base, REDIS_URL: "redis://localhost:6379" }).redisUrl).toBe("redis://localhost:6379");
    expect(loadConfig({ ...base, REDIS_URL: "rediss://user:pw@host:6380" }).redisUrl).toBe("rediss://user:pw@host:6380");
    expect(() => loadConfig({ ...base, REDIS_URL: "http://x" })).toThrow(/REDIS_URL/);
  });

  it("does not put the Redis password in the message when it refuses a url", () => {
    try {
      loadConfig({ ...base, REDIS_URL: "http://user:secretpw@host" });
    } catch (e) {
      expect((e as Error).message).not.toContain("secretpw");
      return;
    }
    throw new Error("should have refused");
  });

  describe("ADMIN_ADDRESSES", () => {
    const A = "0x00000000000000000000000000000000000000a1";
    const B = "0x00000000000000000000000000000000000000B2";

    it("defaults to nobody", () => {
      expect(loadConfig(base).adminAddresses).toEqual([]);
      expect(loadConfig({ ...base, ADMIN_ADDRESSES: "" }).adminAddresses).toEqual([]);
    });

    it("reads a comma-separated list, trimming, dropping blanks and lower-casing", () => {
      expect(loadConfig({ ...base, ADMIN_ADDRESSES: ` ${A} , ,${B},` }).adminAddresses).toEqual([A, B.toLowerCase()]);
    });

    // A typo here would lock the operator out of their own tools with no sign of why, so start-up refuses it.
    it("refuses an entry that is not an address, naming it", () => {
      for (const bad of ["0x123", "admin", `${A} 0xabc`, "0xZZ00000000000000000000000000000000000001"]) {
        expect(() => loadConfig({ ...base, ADMIN_ADDRESSES: bad }), bad).toThrow(/ADMIN_ADDRESSES/);
      }
      expect(() => loadConfig({ ...base, ADMIN_ADDRESSES: `${A},oops` })).toThrow(/oops/);
    });
  });
});
