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

// ---- Creating a token: the form, and the document it becomes ------------------------------------------------------
// One schema for the browser (to help a person fix the form) and for the API (which is the real boundary: the browser
// check is a convenience, the API check cannot be skipped).

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const; // never SVG: it can carry script

/** The four launch-tax windows the contract accepts, in seconds. */
export const ANTI_SNIPER_WINDOWS = [0, 60, 600, 5880] as const;

// Unlike the reader (which DROPS a bad link so one hostile field cannot cost a token its name), the form REJECTS it:
// this is the moment a person can still fix it. An empty field means "not given".
const formLink = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v === "" ? undefined : v))
  .refine((v) => v === undefined || safeHttpUrl(v) !== undefined, "must be an http(s) link");

export const tokenFormSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, "2 to 10 letters or digits"),
  description: z.string().trim().max(500).default(""),
  website: formLink,
  twitter: formLink,
  telegram: formLink,
  antiSniperWindow: z.union([z.literal(0), z.literal(60), z.literal(600), z.literal(5880)]).default(60),
});
export type TokenForm = z.infer<typeof tokenFormSchema>;

/** The JSON that gets pinned, in the shape the reader accepts. `imageCid` is what the image was pinned under. */
export function buildMetadata(form: TokenForm, imageCid: string): TokenMetadata {
  const socials: Record<string, string> = {};
  if (form.website) socials.website = form.website;
  if (form.twitter) socials.twitter = form.twitter;
  if (form.telegram) socials.telegram = form.telegram;
  return {
    name: form.name,
    symbol: form.ticker.toUpperCase(),
    description: form.description,
    image: `ipfs://${imageCid}`,
    socials,
  };
}
