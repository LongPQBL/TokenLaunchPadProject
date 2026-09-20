import { UI } from "@vezta/shared";
import { ApiError } from "../api";

/** What to tell someone whose moderation request was refused. The server's own text is never shown: only its code is read. */
export function explainModerationError(error: unknown): string {
  const e = UI.moderation.errors;
  if (!(error instanceof ApiError)) return e.generic;
  switch (error.code) {
    case "not_found":
      return e.notFound;
    case "rate_limited":
      return e.rateLimited;
    case "network":
      return e.network;
    default:
      return e.generic;
  }
}
