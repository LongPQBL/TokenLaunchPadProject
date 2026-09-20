export type ImageType = "png" | "jpeg" | "webp";

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/**
 * The type of an image, decided by its leading bytes and by nothing else: not the URL, not a Content-Type
 * header, both of which the token's author controls. Only PNG, JPEG and WebP are allowed. SVG is refused because
 * it is XML and can carry script; it has no magic number, so "not one of the three" is exactly how it is caught.
 */
export function sniffImageType(b: Uint8Array): ImageType | undefined {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  return undefined;
}
