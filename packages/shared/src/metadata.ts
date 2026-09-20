import { z } from "zod";

/**
 * Anyone can call the factory with any string and pin any JSON, so every field here is hostile
 * input. A link with a javascript: scheme executes when placed in an href, so URLs are
 * scheme-checked rather than merely parsed (spec §11).
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? trimmed : undefined;
}

// A bad link is dropped, not fatal: one hostile social link must not throw away an otherwise
// valid document (and with it the token's name and image).
const optionalLink = z.unknown().transform(safeHttpUrl);

export const tokenMetadataSchema = z.object({
  name: z.string().min(1).max(32),
  symbol: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Za-z0-9]+$/, "ticker must be letters and digits only"),
  description: z.string().max(500).optional().default(""),
  // ipfs:// or an http(s) URL. Resolved server-side; the browser never dereferences ipfs://.
  image: z.string().max(512).optional(),
  socials: z
    .object({ website: optionalLink, twitter: optionalLink, telegram: optionalLink })
    .partial()
    .optional()
    .default({}),
});

export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;
