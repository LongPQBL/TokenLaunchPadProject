import type { Api } from "./api";
import type { TokenSort } from "./types";

const SORTS: readonly string[] = ["new", "volume", "progress"];
const MAX_QUERY_LENGTH = 64;

/** What Next hands a page for a query-string value: repeated keys arrive as an array. */
type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p);

/** The sort comes straight from the URL, so anything that is not one of the three is the default. */
export function parseSort(raw: Param): TokenSort {
  const value = first(raw);
  return value !== undefined && SORTS.includes(value) ? (value as TokenSort) : "new";
}

/** The URL of a discover view. Defaults are left out, so the plain page keeps the plain URL. */
export function discoverHref(chain: string, o: { sort?: TokenSort; q?: string; cursor?: string }): string {
  const params = new URLSearchParams();
  if (o.sort && o.sort !== "new") params.set("sort", o.sort);
  const q = o.q?.trim();
  if (q) params.set("q", q);
  if (o.cursor) params.set("cursor", o.cursor);
  const query = params.toString();
  return `/${encodeURIComponent(chain)}${query ? `?${query}` : ""}`;
}

/** Everything the discover page needs, from the raw query string. */
export async function loadDiscover(api: Api, chain: string, params: { sort?: Param; q?: Param; cursor?: Param }) {
  const sort = parseSort(params.sort);
  const q = (first(params.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const cursor = first(params.cursor) || undefined;
  const page = await api.tokens(chain, { sort, q, cursor });
  return { sort, q, page };
}
