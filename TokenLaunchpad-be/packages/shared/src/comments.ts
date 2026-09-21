/** The longest a comment may be, counted in characters as a person counts them (an emoji is one). The API enforces the same number. */
export const MAX_COMMENT_CHARS = 500;

// Explicit direction controls: embeddings and overrides (U+202A-202E) and isolates (U+2066-2069). A comment is hostile text,
// and one of these can reverse what is drawn after it: an address written backwards, a name that reads as another.
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;

/** Text with its direction controls removed. Everything else, including right-to-left scripts, is left as written. */
export const neutraliseBidi = (text: string): string => text.replace(BIDI_CONTROLS, "");

/** How long a comment counts as, as the API will count it: the ends do not count, and an emoji is one. */
export const commentLength = (text: string): number => [...text.trim()].length;
