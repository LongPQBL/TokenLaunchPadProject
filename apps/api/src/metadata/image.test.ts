import { describe, expect, it } from "vitest";
import { sniffImageType } from "./image.js";

const bytes = (...b: number[]) => Uint8Array.from([...b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

describe("sniffImageType", () => {
  it("recognises PNG, JPEG and WebP by their magic bytes", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImageType(Uint8Array.from([...text("RIFF"), 1, 2, 3, 4, ...text("WEBP"), 0, 0]))).toBe("webp");
  });

  // SVG is XML and can carry script. It must be refused whatever the URL or the declared type says.
  it("refuses SVG, whatever it looks like", () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeUndefined();
    expect(sniffImageType(text('<?xml version="1.0"?><svg/>'))).toBeUndefined();
    expect(sniffImageType(text("   <svg/>"))).toBeUndefined();
  });

  it("refuses formats that are not on the list, and things that are not images at all", () => {
    expect(sniffImageType(text("GIF89a......."))).toBeUndefined();
    expect(sniffImageType(text("<html><script>alert(1)</script></html>"))).toBeUndefined();
    expect(sniffImageType(text("%PDF-1.7"))).toBeUndefined();
    expect(sniffImageType(new Uint8Array())).toBeUndefined();
    expect(sniffImageType(bytes(0x00))).toBeUndefined();
  });

  it("does not take a RIFF container that is not WebP for WebP", () => {
    expect(sniffImageType(Uint8Array.from([...text("RIFF"), 1, 2, 3, 4, ...text("WAVE"), 0, 0]))).toBeUndefined();
  });

  it("is not fooled by an image signature that only appears later in the file", () => {
    expect(sniffImageType(Uint8Array.from([...text("<svg>"), 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeUndefined();
  });
});
