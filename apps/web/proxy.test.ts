import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const get = () => proxy(new NextRequest("http://localhost:3100/sepolia"));
const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)![1]!;

describe("proxy", () => {
  it("sets a Content-Security-Policy on every page", () => {
    const csp = get().headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("uses a different nonce for every request: a nonce that repeats is one an attacker can learn", () => {
    const nonces = new Set(Array.from({ length: 20 }, () => nonceOf(get().headers.get("content-security-policy")!)));
    expect(nonces.size).toBe(20);
  });

  it("makes the nonce at least 128 bits", () => {
    const nonce = nonceOf(get().headers.get("content-security-policy")!);
    expect(Buffer.from(nonce, "base64").length).toBeGreaterThanOrEqual(16);
  });

  it("hands the same nonce and policy to the page's own rendering, so the scripts Next writes can carry it", () => {
    const res = get();
    const csp = res.headers.get("content-security-policy")!;
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonceOf(csp));
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("does not run for static files and prefetches, which have no scripts of their own to protect", () => {
    expect(config.matcher[0]!.source).toMatch(/_next\/static/);
    expect(config.matcher[0]!.source).toMatch(/_next\/image/);
    expect(config.matcher[0]!.source).toMatch(/favicon/);
  });
});
