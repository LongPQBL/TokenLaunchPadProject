import { z } from "zod";

// Shared by the frontend (form validation) and the backend (upload endpoint), so both apply the same rules.
// The contract stores none of this: only the `metadataURI` (ipfs://<cid of the JSON below>) is emitted in TokenCreated.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const; // never SVG: it can carry scripts

const url = z.string().url().max(200).refine((u) => /^https?:\/\//.test(u), "http(s) only");

/** What a user types in the "create token" form. */
export const tokenFormSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, "2 to 10 letters or digits"),
  description: z.string().trim().max(500).default(""),
  website: url.optional(),
  twitter: url.optional(),
  telegram: url.optional(),
  antiSniperWindow: z.union([z.literal(0), z.literal(60), z.literal(600), z.literal(5880)]).default(60),
});
export type TokenForm = z.infer<typeof tokenFormSchema>;

/** The JSON pinned to IPFS. `image` points to the pinned image. */
export const tokenMetadataSchema = z.object({
  name: z.string().max(32),
  symbol: z.string().max(10),
  description: z.string().max(500),
  image: z.string().regex(/^ipfs:\/\/[A-Za-z0-9]+$/, "must be an ipfs:// CID"),
  external_url: url.optional(),
  socials: z.object({ twitter: url.optional(), telegram: url.optional() }).default({}),
});
export type TokenMetadata = z.infer<typeof tokenMetadataSchema>;

/** Builds the metadata JSON from a validated form and the CID the image was pinned under. */
export function buildMetadata(form: TokenForm, imageCid: string): TokenMetadata {
  return tokenMetadataSchema.parse({
    name: form.name,
    symbol: form.ticker.toUpperCase(),
    description: form.description,
    image: `ipfs://${imageCid}`,
    external_url: form.website,
    socials: { twitter: form.twitter, telegram: form.telegram },
  });
}
