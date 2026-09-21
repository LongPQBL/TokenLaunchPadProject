import { ALLOWED_IMAGE_TYPES, buildMetadata, MAX_IMAGE_BYTES, tokenFormSchema } from "@vezta/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app.js";
import { requireSession } from "../auth/session.js";
import { apiError } from "../errors.js";
import { BadImageError, normaliseImage } from "../metadata/image.js";
import { PinError, type Pinner } from "../metadata/pin.js";
import { consumeRateLimit } from "../middleware/rate-limit.js";

/** The image plus a few short text fields. Anything bigger is not a token launch, and is refused before it is read. */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 512 * 1024;
const UPLOADS_PER_HOUR = 5;

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Turns a logo and a form into a metadata URI a token can be created with. The API is the boundary, not the browser:
 * the form is validated here, the image is decoded and re-encoded from its pixels (so nothing hiding around it is
 * pinned), and the pinning key never leaves this process. The response is one field, the URI.
 *
 * The rate limit is checked after validation and before pinning: a person fixing a typo does not spend an upload,
 * and the quota that costs money (pinning) is what the limit protects.
 */
export function metadataRoutes(deps: { pinner?: Pinner }): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.post(
    "/metadata",
    requireSession,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, "too_large", "That upload is too large.") }),
    async (c) => {
      const { pinner } = deps;
      if (!pinner) return apiError(c, 503, "uploads_unavailable", "Uploads are not available right now.");

      let body: Record<string, unknown>;
      try {
        body = await c.req.parseBody();
      } catch {
        return apiError(c, 400, "bad_request", "Send the logo and the form as multipart form data.");
      }

      const window = text(body.antiSniperWindow);
      const form = tokenFormSchema.safeParse({
        name: text(body.name),
        ticker: text(body.ticker),
        description: text(body.description),
        website: text(body.website),
        twitter: text(body.twitter),
        telegram: text(body.telegram),
        antiSniperWindow: window === undefined ? undefined : /^\d{1,5}$/.test(window) ? Number(window) : window,
      });
      if (!form.success) {
        // Which fields, never what was sent: an error that repeats the input is a reflection vector.
        const fields = [...new Set(form.error.issues.map((i) => String(i.path[0])))];
        return c.json({ error: "bad_form", message: "Some fields are not valid.", fields }, 400);
      }

      const file = body.image;
      if (!(file instanceof File)) return apiError(c, 400, "bad_image", "Choose a PNG, JPEG or WebP image.");
      if (file.size > MAX_IMAGE_BYTES) return apiError(c, 400, "bad_image", "The image must be 2 MB or smaller.");

      let image: { buffer: Buffer; contentType: string };
      try {
        image = await normaliseImage(Buffer.from(await file.arrayBuffer()));
      } catch (e) {
        if (e instanceof BadImageError) return apiError(c, 400, "bad_image", e.message);
        throw e;
      }

      const limit = await consumeRateLimit("upload", c.get("address"), UPLOADS_PER_HOUR, 3600);
      if (!limit.allowed) {
        c.header("Retry-After", String(limit.retryAfterSeconds));
        return apiError(c, 429, "rate_limited", "You have uploaded a lot recently. Please try again later.");
      }

      try {
        const ext = ALLOWED_IMAGE_TYPES.includes(image.contentType as (typeof ALLOWED_IMAGE_TYPES)[number]) ? image.contentType.slice(6) : "img";
        const imageCid = await pinner.pinFile(image.buffer, `${form.data.ticker.toLowerCase()}.${ext}`, image.contentType);
        const documentCid = await pinner.pinJson(buildMetadata(form.data, imageCid), `${form.data.ticker.toLowerCase()}.json`);
        return c.json({ metadataURI: `ipfs://${documentCid}` });
      } catch (e) {
        if (e instanceof PinError) {
          // Only the status: the service's own words, and anything the network layer said, may hold the key.
          console.error(`metadata: pinning failed (status ${e.status ?? "none"})`);
          return apiError(c, 502, "pin_failed", "Could not store the image right now. Please try again.");
        }
        throw e;
      }
    },
  );

  return routes;
}
