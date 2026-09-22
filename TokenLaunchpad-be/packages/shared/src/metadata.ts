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

/** Whether a URL's host is one of the given domains, or a subdomain of one: x.com and www.x.com both match "x.com",
 * but the lookalike x.com.evil.example does not. */
function hostMatches(url: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

const TWITTER_HOSTS = ["twitter.com", "x.com", "t.co"] as const; // t.co: Twitter's own link shortener
const TELEGRAM_HOSTS = ["t.me", "telegram.me"] as const;

/** Like optionalLink, but for a platform whose real domain is known: a link that does not point at it is dropped
 * exactly as a non-http(s) one is, since a page shows a Twitter or Telegram icon next to it and that icon would
 * otherwise be a lie about where the link actually goes. */
const platformLink = (hosts: readonly string[]) =>
  z.unknown().transform((v) => {
    const url = safeHttpUrl(v);
    return url && hostMatches(url, hosts) ? url : undefined;
  });

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
    .object({ website: optionalLink, twitter: platformLink(TWITTER_HOSTS), telegram: platformLink(TELEGRAM_HOSTS) })
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
// this is the moment a person can still fix it. An empty field means "not given". `hosts`, given, additionally
// requires the link to really point at that platform (see platformLink): a Twitter field is for a twitter.com or
// x.com link, not any link at all.
const formLink = (hosts: readonly string[] | undefined, message: string) =>
  z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .refine((v) => {
      if (v === undefined) return true;
      const url = safeHttpUrl(v);
      return !!url && (!hosts || hostMatches(url, hosts));
    }, message);

export const tokenFormSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, "2 to 10 letters or digits"),
  description: z.string().trim().max(500).default(""),
  website: formLink(undefined, "must be an http(s) link"),
  twitter: formLink(TWITTER_HOSTS, "must be a twitter.com or x.com link"),
  telegram: formLink(TELEGRAM_HOSTS, "must be a t.me link"),
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
