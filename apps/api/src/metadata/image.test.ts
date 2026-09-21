import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { jpeg, png, SVG, webp } from "../../test/images.js";
import { BadImageError, normaliseImage, sniffImageType } from "./image.js";

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

describe("normaliseImage", () => {
  it("re-encodes each allowed type as itself, so a PNG stays a PNG", async () => {
    expect((await normaliseImage(await png())).contentType).toBe("image/png");
    expect((await normaliseImage(await jpeg())).contentType).toBe("image/jpeg");
    expect((await normaliseImage(await webp())).contentType).toBe("image/webp");
  });

  it("returns bytes that are really that type, by their own magic numbers", async () => {
    const { buffer } = await normaliseImage(await png());
    expect(sniffImageType(buffer)).toBe("png");
  });

  it("drops a payload appended after the image: what is pinned is only what decoded", async () => {
    const dirty = Buffer.concat([await png(), Buffer.from("<script>alert(1)</script>")]);
    const { buffer } = await normaliseImage(dirty);
    expect(buffer.includes("<script>")).toBe(false);
    expect(buffer.includes("alert(1)")).toBe(false);
  });

  it("drops embedded metadata such as EXIF, which can carry a location or a name", async () => {
    const withExif = await sharp(await jpeg()).withExif({ IFD0: { Copyright: "SECRET-OWNER-NAME" } }).jpeg().toBuffer();
    expect(withExif.includes("SECRET-OWNER-NAME")).toBe(true); // the fixture really has it
    const { buffer } = await normaliseImage(withExif);
    expect(buffer.includes("SECRET-OWNER-NAME")).toBe(false);
  });

  it("shrinks a large image to fit 1024 pixels, keeping its proportions, and never enlarges a small one", async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#123456" } }).png().toBuffer();
    const meta = await sharp((await normaliseImage(big)).buffer).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 512]);

    const small = await sharp((await normaliseImage(await png(64))).buffer).metadata();
    expect([small.width, small.height]).toEqual([64, 64]);
  });

  it("refuses an SVG, even one that could be told apart from an image only by its content", async () => {
    await expect(normaliseImage(SVG)).rejects.toBeInstanceOf(BadImageError);
  });

  it("refuses something that is not an image at all", async () => {
    await expect(normaliseImage(Buffer.from("hello, this is not an image"))).rejects.toBeInstanceOf(BadImageError);
    await expect(normaliseImage(Buffer.alloc(0))).rejects.toBeInstanceOf(BadImageError);
  });

  it("refuses a file that starts like an image but is corrupt", async () => {
    const truncated = (await png()).subarray(0, 40);
    await expect(normaliseImage(truncated)).rejects.toBeInstanceOf(BadImageError);
  });

  it("refuses a JPEG cut off part-way through, rather than quietly pinning half a picture", async () => {
    const whole = await jpeg(256);
    const cut = whole.subarray(0, Math.floor(whole.length * 0.6));
    await expect(normaliseImage(cut)).rejects.toBeInstanceOf(BadImageError);
  });

  it("applies the EXIF orientation before dropping it, so a phone photo is not pinned sideways", async () => {
    const sideways = await sharp({ create: { width: 100, height: 50, channels: 3, background: "#888" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const meta = await sharp((await normaliseImage(sideways)).buffer).metadata();
    expect([meta.width, meta.height]).toEqual([50, 100]);
  });

  it("refuses an image whose pixel count is a decompression bomb, however small the file", async () => {
    const bomb = await sharp(Buffer.alloc(7000 * 7000), { raw: { width: 7000, height: 7000, channels: 1 } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024); // small on the wire...
    await expect(normaliseImage(bomb)).rejects.toBeInstanceOf(BadImageError); // ...enormous in memory
  });

  it("refuses a GIF or a TIFF: only PNG, JPEG and WebP", async () => {
    const gif = await sharp(await png()).gif().toBuffer();
    const tiff = await sharp(await png()).tiff().toBuffer();
    await expect(normaliseImage(gif)).rejects.toBeInstanceOf(BadImageError);
    await expect(normaliseImage(tiff)).rejects.toBeInstanceOf(BadImageError);
  });
});
