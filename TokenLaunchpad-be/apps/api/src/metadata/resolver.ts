import { prisma, type Prisma } from "@vezta/app-db";
import { tokenMetadataSchema } from "@vezta/shared";
import { getSql } from "../db.js";
import { sniffImageType } from "./image.js";
import { DEFAULT_IPFS_GATEWAY, ipfsToHttp } from "./ipfs.js";

const MAX_DOC_BYTES = 100_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // the same cap the upload endpoint enforces
const MAX_ATTEMPTS = 5;
const FETCH_TIMEOUT_MS = 10_000;
const LEASE_MS = 5 * 60_000;
const DEFAULT_BATCH = 20;
const DISCOVERY_LIMIT = 500;
const CONCURRENCY = 5;

/** Might work later: a gateway that is slow, busy or down. Retried with backoff. */
class Transient extends Error {}
/** Will never work: retrying cannot help. The token is marked invalid at once. */
class Permanent extends Error {}

export interface ResolveOptions {
  now?: Date;
  fetch?: typeof fetch;
  /** The one host the resolver is allowed to contact. */
  gateway?: string;
  batch?: number;
}

interface Deps {
  now: Date;
  fetch: typeof fetch;
  gateway: string;
}

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw new Permanent("too large");
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // Stop reading the moment the cap is passed: a 10 MB "document" is never downloaded to the end.
    if (total > max) {
      await reader.cancel();
      throw new Permanent("too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function fetchBytes(url: string, max: number, deps: Deps): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await deps.fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new Transient(`network error: ${String(e)}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    throw retryable ? new Transient(`gateway ${res.status}`) : new Permanent(`gateway ${res.status}`);
  }
  try {
    return await readCapped(res, max);
  } catch (e) {
    if (e instanceof Permanent) throw e;
    throw new Transient(`read error: ${String(e)}`);
  }
}

async function fetchAndValidate(uri: string, deps: Deps) {
  const docUrl = ipfsToHttp(uri, deps.gateway);
  if (!docUrl) throw new Permanent("metadata URI is not a safe ipfs:// URI");

  const bytes = await fetchBytes(docUrl, MAX_DOC_BYTES, deps);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Permanent("not JSON");
  }
  const result = tokenMetadataSchema.safeParse(parsed);
  if (!result.success) throw new Permanent("fails validation");
  const meta = result.data;

  let imageCdnUrl: string | null = null;
  if (meta.image) {
    // ipfs:// only, for the same reason as the document: an http(s) image would make us fetch a stranger's host.
    const imageUrl = ipfsToHttp(meta.image, deps.gateway);
    if (!imageUrl) throw new Permanent("image must be an ipfs:// URI");
    const image = await fetchBytes(imageUrl, MAX_IMAGE_BYTES, deps);
    if (!sniffImageType(image)) throw new Permanent("image is not PNG, JPEG or WebP");
    imageCdnUrl = imageUrl;
  }
  return { meta, imageCdnUrl };
}

/**
 * Every write is guarded by `status: "pending"`. A moderator can hide a token while its metadata is in flight;
 * without the guard the result would be written back over "hidden" and undo the moderation.
 */
async function resolveOne(row: { chainId: number; token: string; uri: string; attempts: number }, deps: Deps) {
  const where = { chainId: row.chainId, token: row.token, status: "pending" };
  const attempts = row.attempts + 1;
  try {
    const { meta, imageCdnUrl } = await fetchAndValidate(row.uri, deps);
    const written = await prisma.tokenMetadata.updateMany({
      where,
      data: {
        status: "ok",
        name: meta.name,
        symbol: meta.symbol,
        description: meta.description,
        imageUri: meta.image ?? null,
        imageCdnUrl,
        socials: meta.socials as Prisma.InputJsonValue,
        attempts,
        nextAttempt: null,
        fetchedAt: deps.now,
      },
    });
    return written.count === 1 ? "resolved" : "skipped";
  } catch (e) {
    if (!(e instanceof Transient) && !(e instanceof Permanent)) throw e;
    const giveUp = e instanceof Permanent || attempts >= MAX_ATTEMPTS;
    const written = await prisma.tokenMetadata.updateMany({
      where,
      data: giveUp
        ? { status: "invalid", attempts, nextAttempt: null, fetchedAt: deps.now }
        : { attempts, nextAttempt: new Date(deps.now.getTime() + 2 ** attempts * 60_000) },
    });
    return written.count === 1 ? "failed" : "skipped";
  }
}

/** Indexed tokens that name a metadata URI but have no cache row yet get a pending one. Existing rows are never touched. */
async function discoverNewTokens(): Promise<void> {
  await getSql()`
    insert into app.token_metadata (chain_id, token, uri)
    select t.chain_id, t.address, t.metadata_uri
    from launchpad.token t
    where t.metadata_uri is not null
      and not exists (select 1 from app.token_metadata m where m.chain_id = t.chain_id and m.token = t.address)
    limit ${DISCOVERY_LIMIT}
    on conflict do nothing`;
}

/**
 * Takes a lease on a row, or reports that someone else already did.
 *
 * A compare-and-set on next_attempt: the update matches only if the row is still pending AND next_attempt is still
 * what the caller read. Of two claimers holding the same stale read, the database lets exactly one through, which
 * is what stops two overlapping passes, or two API instances, fetching the same token twice. The lease also pushes
 * next_attempt five minutes out, so a crash mid-fetch only delays the retry.
 */
export async function claimRow(row: { chainId: number; token: string; nextAttempt: Date | null }, now: Date): Promise<boolean> {
  const won = await prisma.tokenMetadata.updateMany({
    where: { chainId: row.chainId, token: row.token, status: "pending", nextAttempt: row.nextAttempt },
    data: { nextAttempt: new Date(now.getTime() + LEASE_MS) },
  });
  return won.count === 1;
}

/**
 * One pass: find new tokens, claim the pending rows that are due, and resolve them.
 *
 * Failures are classified: a slow gateway is retried with exponential backoff (2, 4, 8, 16 minutes) and only
 * marked invalid after five attempts; a 404, bad JSON, a failed validation, an oversized or banned image, or an
 * unsafe URI is invalid at once, because retrying cannot help.
 */
export async function resolvePending(opts: ResolveOptions = {}): Promise<{ resolved: number; failed: number }> {
  const deps: Deps = { now: opts.now ?? new Date(), fetch: opts.fetch ?? fetch, gateway: opts.gateway ?? DEFAULT_IPFS_GATEWAY };

  await discoverNewTokens();

  const due = await prisma.tokenMetadata.findMany({
    where: { status: "pending", OR: [{ nextAttempt: null }, { nextAttempt: { lte: deps.now } }] },
    orderBy: [{ nextAttempt: { sort: "asc", nulls: "first" } }, { chainId: "asc" }, { token: "asc" }],
    take: opts.batch ?? DEFAULT_BATCH,
  });

  const claimed = [];
  for (const row of due) {
    if (await claimRow(row, deps.now)) claimed.push(row);
  }

  let resolved = 0;
  let failed = 0;
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(claimed.slice(i, i + CONCURRENCY).map((row) => resolveOne(row, deps)));
    for (const outcome of outcomes) {
      if (outcome === "resolved") resolved++;
      else if (outcome === "failed") failed++;
    }
  }
  return { resolved, failed };
}
