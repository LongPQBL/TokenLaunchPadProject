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

/** The upload is not an image we accept. The message is safe to show. */
export class BadImageError extends Error {}

/** No side of a pinned image is longer than this: it is shown at a few hundred pixels at most. */
const MAX_SIDE = 1024;
/** Refuses a "small" file that unpacks to hundreds of megabytes of pixels (a decompression bomb). ~5000 x 5000. */
const MAX_PIXELS = 25_000_000;

/**
 * Decodes an upload and encodes it again from the pixels, so what gets pinned is exactly what decoded. That drops
 * anything hiding around the image: bytes appended after it, a script in a comment chunk, EXIF with a location or a
 * name. The type is decided by the leading bytes (never by the declared type), only PNG, JPEG and WebP are allowed,
 * and the image keeps its type. Anything else, or anything that will not decode, is a BadImageError.
 */
export async function normaliseImage(input: Buffer): Promise<{ buffer: Buffer; contentType: string }> {
  const type = sniffImageType(input);
  if (!type) throw new BadImageError("The image must be a PNG, JPEG or WebP.");

  try {
    // Loaded on first use: the metadata resolver imports this file only for sniffImageType, and loading a native image
    // library there would slow every start-up (and its tests) for nothing.
    const { default: sharp } = await import("sharp");
    // failOn "error": a truncated or corrupt file is refused rather than quietly repaired into something else.
    const pipeline = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: "error" })
      .rotate() // apply the EXIF orientation now, because the EXIF is about to be dropped
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true });
    const encoded = type === "png" ? pipeline.png() : type === "jpeg" ? pipeline.jpeg({ quality: 90 }) : pipeline.webp({ quality: 90 });
    return { buffer: await encoded.toBuffer(), contentType: `image/${type}` };
  } catch {
    throw new BadImageError("That image could not be read.");
  }
}
