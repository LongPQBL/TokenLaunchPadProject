import sharp from "sharp";

/** Real images, made by the same library that will decode them, so the tests use inputs a browser could really send. */
export const png = (size = 64) => sharp({ create: { width: size, height: size, channels: 3, background: "#3366cc" } }).png().toBuffer();
export const jpeg = (size = 64) => sharp({ create: { width: size, height: size, channels: 3, background: "#cc6633" } }).jpeg().toBuffer();
export const webp = (size = 64) => sharp({ create: { width: size, height: size, channels: 3, background: "#33cc66" } }).webp().toBuffer();

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
