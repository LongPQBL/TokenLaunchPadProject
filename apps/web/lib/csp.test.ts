import { describe, expect, it } from "vitest";
import { buildCsp, cspSources } from "./csp";

const base = { nonce: "abc123", isDev: false, apiUrl: "https://api.launchpad.example", rpcUrl: "https://rpc.example/v1/key", imageOrigins: [], walletConnect: false };
const directive = (csp: string, name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `) || d === name);

describe("buildCsp", () => {
  it("falls back to this site alone for anything it does not name", () => {
    expect(directive(buildCsp(base), "default-src")).toBe("default-src 'self'");
  });

  it("allows scripts only from this site or carrying the request's nonce, and never inline without one", () => {
    const script = directive(buildCsp(base), "script-src")!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
  });

  it("allows eval in development only, because React's dev tools use it", () => {
    expect(directive(buildCsp({ ...base, isDev: true }), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildCsp(base), "script-src")).not.toContain("'unsafe-eval'");
  });

  it("is strict about scripts but lets styles be inline: dialogs create <style> elements at run time, and a stylesheet cannot run script", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
    // and the nonce is NOT in style-src: a nonce there would make the browser ignore 'unsafe-inline'
    expect(directive(csp, "style-src")).not.toContain("nonce");
  });

  it("lets the page talk to itself, the API and the chain's RPC, and nowhere else", () => {
    expect(directive(buildCsp(base), "connect-src")).toBe("connect-src 'self' https://api.launchpad.example wss://api.launchpad.example https://rpc.example");
  });

  it("names the API's websocket address too, ws:// for http and wss:// for https", () => {
    expect(directive(buildCsp({ ...base, apiUrl: "http://localhost:3101" }), "connect-src")).toContain("ws://localhost:3101");
    expect(directive(buildCsp(base), "connect-src")).toContain("wss://api.launchpad.example");
  });

  it("names an RPC by its origin only, so a path or an API key in the URL is not repeated in a header", () => {
    expect(buildCsp(base)).not.toContain("/v1/key");
  });

  it("adds WalletConnect's relay only when WalletConnect is configured", () => {
    expect(buildCsp(base)).not.toContain("walletconnect");
    expect(directive(buildCsp({ ...base, walletConnect: true }), "connect-src")).toContain("wss://relay.walletconnect.org");
  });

  it("allows images from this site, inline data (wallet icons) and the configured image hosts, not from any https host", () => {
    expect(directive(buildCsp(base), "img-src")).toBe("img-src 'self' data: blob:");
    expect(directive(buildCsp({ ...base, imageOrigins: ["https://ipfs.io"] }), "img-src")).toBe("img-src 'self' data: blob: https://ipfs.io");
  });

  it("forbids plugins, framing, and a changed base URL, and only lets forms go to this site", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
  });

  it("upgrades insecure requests only when the API is itself served over https", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, apiUrl: "http://localhost:3101" })).not.toContain("upgrade-insecure-requests");
  });

  it("cannot be talked into a directive of someone else's: a nonce must be plain base64, an origin must parse", () => {
    expect(() => buildCsp({ ...base, nonce: "x'; script-src *; '" })).toThrow(/nonce/);
    const csp = buildCsp({ ...base, imageOrigins: ["https://ok.example", "javascript:alert(1)", "https://a.example; script-src *"] });
    expect(csp).toContain("https://ok.example");
    expect(csp).not.toContain("script-src *");
    expect(csp).not.toContain("javascript:");
    expect(csp).not.toContain("a.example");
  });

  it("with no RPC configured, allows the one the chain's client falls back to, so reads still work", () => {
    expect(directive(buildCsp({ ...base, rpcUrl: undefined }), "connect-src")).toMatch(/https:\/\/[^ ]*thirdweb\.com|https:\/\/[^ ]*sepolia/);
  });
});

describe("cspSources", () => {
  it("reads the origins from the build's environment, dropping what is not a URL", () => {
    const s = cspSources({ NEXT_PUBLIC_API_URL: "https://api.example/x", NEXT_PUBLIC_RPC_URL: "not a url", NEXT_PUBLIC_IMAGE_ORIGINS: "https://ipfs.io, nope ,https://cdn.example/path", NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "abc" });
    expect(s).toEqual({ apiUrl: "https://api.example/x", rpcUrl: undefined, imageOrigins: ["https://ipfs.io", "https://cdn.example"], walletConnect: true, privy: false });
  });

  it("has sensible local defaults", () => {
    expect(cspSources({})).toEqual({ apiUrl: "http://localhost:3001", rpcUrl: undefined, imageOrigins: [], walletConnect: false, privy: false });
  });
});

describe("Privy", () => {
  it("adds Privy's frames and connections only when Privy is on", () => {
    const off = buildCsp(base);
    const on = buildCsp({ ...base, privy: true });
    expect(directive(off, "frame-src")).toBeUndefined();
    expect(directive(off, "connect-src")).not.toContain("privy");
    const frames = directive(on, "frame-src")!;
    for (const origin of ["https://auth.privy.io", "https://verify.walletconnect.com", "https://verify.walletconnect.org", "https://challenges.cloudflare.com"]) {
      expect(frames).toContain(origin);
    }
    const connect = directive(on, "connect-src")!;
    for (const origin of ["https://auth.privy.io", "https://*.rpc.privy.systems", "wss://relay.walletconnect.com", "wss://relay.walletconnect.org", "wss://www.walletlink.org", "https://explorer-api.walletconnect.com"]) {
      expect(connect).toContain(origin);
    }
    expect(directive(on, "child-src")).toContain("https://auth.privy.io");
  });

  it("does not loosen scripts for Privy: still nonce + strict-dynamic, no eval, no wildcard, no unsafe-inline", () => {
    const script = directive(buildCsp({ ...base, privy: true }), "script-src")!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("keeps everything else it had: framing, form posts, objects, the base URI", () => {
    const csp = buildCsp({ ...base, privy: true });
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("lets the wallet logos Privy's login screen shows load, from WalletConnect's explorer only, and only with Privy on", () => {
    // (found by the e2e run: the screen draws each wallet's logo from there, and the policy blocked it)
    expect(directive(buildCsp({ ...base, privy: true }), "img-src")).toContain("https://explorer-api.walletconnect.com");
    expect(directive(buildCsp(base), "img-src")).not.toContain("walletconnect");
    const images = directive(buildCsp({ ...base, privy: true }), "img-src")!.split(" ").slice(1);
    expect(images.filter((i) => i.startsWith("https:") && i !== "https://explorer-api.walletconnect.com")).toEqual([]); // no wildcard https:
  });

  it("does not open frames to any other origin: frame-src names exactly Privy's, WalletConnect's verifier and Cloudflare's", () => {
    const frames = directive(buildCsp({ ...base, privy: true }), "frame-src")!.split(" ").slice(1);
    expect(frames.sort()).toEqual(["https://auth.privy.io", "https://challenges.cloudflare.com", "https://verify.walletconnect.com", "https://verify.walletconnect.org"]);
  });

  it("is on when the build has an App ID, and off for none or a blank one", () => {
    expect(cspSources({ NEXT_PUBLIC_PRIVY_APP_ID: "cmuap9z3s01wc0cl9aqwaf2ei" }).privy).toBe(true);
    expect(cspSources({ NEXT_PUBLIC_PRIVY_APP_ID: "  " }).privy).toBe(false);
    expect(cspSources({}).privy).toBe(false);
  });
});
