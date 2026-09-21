import { describe, expect, it } from "vitest";
import { ipfsToHttp } from "./ipfs.js";

const GW = "https://gw.test";

describe("ipfsToHttp", () => {
  it("maps an ipfs:// URI onto the configured gateway", () => {
    expect(ipfsToHttp("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", GW)).toBe(
      "https://gw.test/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    );
  });

  it("keeps a path inside the content", () => {
    expect(ipfsToHttp("ipfs://bafycid/metadata/1.json", GW)).toBe("https://gw.test/ipfs/bafycid/metadata/1.json");
  });

  it("tolerates a trailing slash on the gateway", () => {
    expect(ipfsToHttp("ipfs://bafycid", "https://gw.test/")).toBe("https://gw.test/ipfs/bafycid");
  });

  // The URI is written on-chain by anyone. Fetching http(s) would make our server request whatever a stranger names:
  // cloud metadata endpoints, or a database on localhost. Only ipfs:// through OUR gateway is ever fetched.
  it("refuses every scheme except ipfs, so the server can never be aimed at an arbitrary host", () => {
    for (const uri of [
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.example.com/x.json",
      "http://localhost:5432/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:application/json,{}",
      "ftp://example.com/x",
      "//evil.example.com/x",
      "bafybeigdyrzt5sfp7udm7hu76uh7y",
      "",
    ]) {
      expect(ipfsToHttp(uri, GW), uri).toBeUndefined();
    }
  });

  it("refuses a content id or path that could climb out of /ipfs/ or change the host", () => {
    for (const uri of [
      "ipfs://../etc/passwd",
      "ipfs://bafycid/../../admin",
      "ipfs://bafycid/%2e%2e/admin",
      "ipfs://user@evil.example.com/x",
      "ipfs://evil.example.com:8080/x",
      "ipfs://bafycid\\..\\x",
      "ipfs://bafy cid",
      "ipfs://",
      "ipfs:///",
      "ipfs://bafycid?x=1",
      "ipfs://bafycid#frag",
      "ipfs://" + "a".repeat(200),
    ]) {
      expect(ipfsToHttp(uri, GW), uri).toBeUndefined();
    }
  });

  it("is case-sensitive about the scheme only in the way URLs are: ipfs:// in any case is accepted", () => {
    expect(ipfsToHttp("IPFS://bafycid", GW)).toBe("https://gw.test/ipfs/bafycid");
  });
});
