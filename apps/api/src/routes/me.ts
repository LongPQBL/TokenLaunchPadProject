import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@vezta/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app.js";
import { requireSession } from "../auth/session.js";
import { getSql } from "../db.js";
import { apiError } from "../errors.js";
import { BadImageError, normaliseImage } from "../metadata/image.js";
import { ipfsToHttp } from "../metadata/ipfs.js";
import { PinError, type Pinner } from "../metadata/pin.js";
import { consumeRateLimit } from "../middleware/rate-limit.js";

/** A picture plus a name, and the form around them. Anything bigger is not a profile, and is refused before it is read. */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;
const CHANGES_PER_HOUR = 20;
const PICTURES_PER_HOUR = 5;
/** Letters, digits and underscore, 3 to 20 long: the same rule the database enforces, so a name is refused here with a reason and never by a constraint error. */
const USERNAME = /^[A-Za-z0-9_]{3,20}$/;

/**
 * The signed-in person changes their own profile: a username and a picture. WHOSE profile is the session and nothing else: no
 * field names an account. It is a PUT with a form body, so a form on another page cannot send it (a form can only POST or GET),
 * on top of SameSite=Lax withholding the cookie cross-site. Only what is sent changes, and either everything sent is valid and
 * saved or nothing is: a refused picture never leaves a changed name behind.
 *
 * The picture goes through exactly the path a token's logo does (decoded, scaled and encoded again from its pixels, so no
 * script or metadata rides along; SVG is refused) and is pinned by the API, whose key never leaves this process.
 */
export function meRoutes(deps: { pinner?: Pinner; ipfsGateway: string }): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.put(
    "/me",
    requireSession,
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 413, "too_large", "That upload is too large.") }),
    async (c) => {
      const address = c.get("address");
      const sql = getSql();

      let body: Record<string, unknown>;
      try {
        body = await c.req.parseBody();
      } catch {
        return apiError(c, 400, "bad_request", "Send the profile as form data.");
      }

      const [existing] = await sql`select banned_at from app.app_user where address = ${address}`;
      if (existing?.banned_at) return apiError(c, 403, "banned", "You cannot change this profile.");

      // What was sent. Absent means "leave it as it is"; an empty username means "clear it".
      const sentName = body.username !== undefined;
      let username: string | null = null;
      if (sentName) {
        const raw = body.username;
        const name = typeof raw === "string" ? raw.trim() : undefined;
        if (name === undefined || (name !== "" && (!USERNAME.test(name) || /^0x/i.test(name)))) {
          return apiError(c, 400, "bad_username", "Use 3 to 20 letters, digits or underscores, and not something that looks like an address.");
        }
        username = name === "" ? null : name;
      }
      const avatar = body.avatar;
      const sentAvatar = avatar instanceof File;
      const removeAvatar = body.removeAvatar === "true";
      if (!sentName && !sentAvatar && !removeAvatar) return apiError(c, 400, "bad_request", "Send a username or a picture.");

      let image: { buffer: Buffer; contentType: string } | undefined;
      if (sentAvatar) {
        if (!deps.pinner) return apiError(c, 503, "uploads_unavailable", "Uploads are not available right now.");
        if (avatar.size > MAX_IMAGE_BYTES) return apiError(c, 400, "bad_image", "The image must be 2 MB or smaller.");
        try {
          image = await normaliseImage(Buffer.from(await avatar.arrayBuffer()));
        } catch (e) {
          if (e instanceof BadImageError) return apiError(c, 400, "bad_image", e.message);
          throw e;
        }
      }

      // Only now, when everything sent is valid: a refusal for a typo costs nothing.
      const changes = await consumeRateLimit("profile", address, CHANGES_PER_HOUR, 3600);
      const pictures = image ? await consumeRateLimit("avatar", address, PICTURES_PER_HOUR, 3600) : undefined;
      const refused = !changes.allowed ? changes : pictures && !pictures.allowed ? pictures : undefined;
      if (refused) {
        c.header("Retry-After", String(refused.retryAfterSeconds));
        return apiError(c, 429, "rate_limited", "You have changed your profile a lot recently. Please try again later.");
      }

      let avatarUri: string | null | undefined;
      if (image && deps.pinner) {
        try {
          const ext = ALLOWED_IMAGE_TYPES.includes(image.contentType as (typeof ALLOWED_IMAGE_TYPES)[number]) ? image.contentType.slice(6) : "img";
          avatarUri = `ipfs://${await deps.pinner.pinFile(image.buffer, `avatar-${address.slice(2, 10)}.${ext}`, image.contentType)}`;
        } catch (e) {
          if (e instanceof PinError) {
            // Only the status: the service's own words, and anything the network layer said, may hold the key.
            console.error(`profile: pinning failed (status ${e.status ?? "none"})`);
            return apiError(c, 502, "pin_failed", "Could not store the image right now. Please try again.");
          }
          throw e;
        }
      } else if (removeAvatar) {
        avatarUri = null;
      }

      try {
        const [row] = await sql`
          insert into app.app_user (address, username, avatar_uri)
          values (${address}, ${sentName ? username : null}, ${avatarUri ?? null})
          on conflict (address) do update set
            username = ${sentName ? sql`excluded.username` : sql`app.app_user.username`},
            avatar_uri = ${avatarUri !== undefined ? sql`excluded.avatar_uri` : sql`app.app_user.avatar_uri`}
          returning username, avatar_uri`;
        const avatarUrl = row!.avatar_uri ? ipfsToHttp(row!.avatar_uri, deps.ipfsGateway) : undefined;
        return c.json({ address, ...(row!.username ? { username: row!.username } : {}), ...(avatarUrl ? { avatarUrl } : {}) });
      } catch (e) {
        // The unique index on lower(username): someone else has the name, in whatever case.
        if ((e as { code?: string }).code === "23505") return apiError(c, 409, "username_taken", "That username is taken.");
        throw e;
      }
    },
  );

  return routes;
}
