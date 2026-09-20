import type { Context, ErrorHandler, NotFoundHandler } from "hono";

/** One error shape for the whole API: a machine code plus text a person can read (spec §5). */
export const apiError = (c: Context, status: 400 | 401 | 403 | 404 | 413 | 429 | 500 | 502 | 503, code: string, message: string) =>
  c.json({ error: code, message }, status);

/**
 * Anything that reaches here is a bug or an outage. The detail goes to the server log (and to Sentry
 * once it is wired in), never to the client: an error message can carry file paths, SQL or secrets.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  console.error(err);
  return c.json({ error: "internal", message: "Something went wrong." }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) => c.json({ error: "not_found", message: "Not found." }, 404);
