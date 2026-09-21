/**
 * A session wallet's signature IS its key, and a report of an error is exactly where one might end up (a message that
 * quotes what was signed, a request body, a breadcrumb). This finds and removes anything shaped like one, for a crash
 * reporter's beforeSend hook. 64 hex digits is a private key, 130 a signature; a transaction hash is also 64 but the
 * rule is deliberately blunt: it redacts those too, since a report can do without them and a key must never leak.
 */
const SECRET = /0x[0-9a-fA-F]{64,}/g;

export const containsSecret = (text: string): boolean => new RegExp(SECRET.source).test(text);

const redact = (text: string) => text.replace(SECRET, "[redacted]");

export function scrubSecrets<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value === "string") return redact(value) as T;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value) as T;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(scrubSecrets(item, seen));
    return out as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, item] of Object.entries(value)) out[redact(key)] = scrubSecrets(item, seen);
  return out as T;
}
