/**
 * Where the backend is. Next only puts `process.env.NEXT_PUBLIC_X` into the browser's code when it is written out in full, so these
 * are the two places that write them out, and everything else asks here (there was a default of its own in nine files).
 */

/** The API on a developer's machine: what the app talks to when NEXT_PUBLIC_API_URL is not set. */
export const DEFAULT_API_URL = "http://localhost:3001";

const present = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/** The API's address: NEXT_PUBLIC_API_URL, or the local backend's. A blank value counts as not set. */
export const apiUrl = (): string => present(process.env.NEXT_PUBLIC_API_URL) ?? DEFAULT_API_URL;

/** The live-updates server: NEXT_PUBLIC_WS_URL, or the API's own address (the one server does both). */
export const wsUrl = (): string => present(process.env.NEXT_PUBLIC_WS_URL) ?? apiUrl();
