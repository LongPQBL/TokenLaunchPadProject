import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { createProfileApi } from "./client";

const profile = createProfileApi({ baseUrl: API });
const ADDRESS = "0x00000000000000000000000000000000000000a1";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** What the API was sent: the method, the cookie policy and every form field (a file by its name and size). */
function capture(reply: { status?: number; body?: unknown } = {}) {
  const seen: { method: string; credentials: string; fields: Record<string, string> }[] = [];
  server.use(
    http.put(`${API}/me`, async ({ request }) => {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      for (const [k, v] of form.entries()) fields[k] = v instanceof File ? `file:${v.name}:${v.size}` : v;
      seen.push({ method: request.method, credentials: request.credentials, fields });
      return HttpResponse.json((reply.body ?? { address: ADDRESS }) as never, { status: reply.status ?? 200 });
    }),
  );
  return seen;
}

describe("updating a profile", () => {
  it("PUTs a form with the session cookie and only the fields that were given", async () => {
    const seen = capture({ body: { address: ADDRESS, username: "alice" } });
    expect(await profile.update({ username: "alice" })).toEqual({ address: ADDRESS, username: "alice" });
    expect(seen[0]).toEqual({ method: "PUT", credentials: "include", fields: { username: "alice" } });
  });

  it("sends an empty username to clear it, which is not the same as not sending one", async () => {
    const seen = capture();
    await profile.update({ username: "" });
    expect(seen[0]!.fields).toEqual({ username: "" });
  });

  it("sends a picture as a file, and a request to remove it", async () => {
    const seen = capture();
    await profile.update({ avatar: new File([new Uint8Array(10)], "me.png", { type: "image/png" }) });
    expect(seen[0]!.fields).toEqual({ avatar: "file:me.png:10" });
    await profile.update({ removeAvatar: true });
    expect(seen[1]!.fields).toEqual({ removeAvatar: "true" });
  });

  it("does not set a content type itself: the browser must add the multipart boundary", async () => {
    let type: string | null = "unset";
    server.use(
      http.put(`${API}/me`, ({ request }) => ((type = request.headers.get("content-type")), HttpResponse.json({ address: ADDRESS }))),
    );
    await profile.update({ username: "alice" });
    expect(type).toMatch(/^multipart\/form-data; boundary=/);
  });

  it.each([
    [409, "username_taken"],
    [400, "bad_username"],
    [400, "bad_image"],
    [429, "rate_limited"],
    [403, "banned"],
    [413, "too_large"],
  ])("turns a %s into an ApiError carrying the code %s", async (status, code) => {
    capture({ status, body: { error: code, message: "m" } });
    await expect(profile.update({ username: "x" })).rejects.toMatchObject({ name: "ApiError", status, code });
  });

  it("reports an unreachable server as a network error, and a reply that is not a profile as bad_response", async () => {
    server.use(http.put(`${API}/me`, () => HttpResponse.error()));
    await expect(profile.update({ username: "x" })).rejects.toMatchObject({ code: "network", status: 0 });
    server.use(http.put(`${API}/me`, () => HttpResponse.json({ nope: true })));
    await expect(profile.update({ username: "x" })).rejects.toMatchObject({ code: "bad_response" });
  });
});
