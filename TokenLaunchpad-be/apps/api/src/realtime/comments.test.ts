import { describe, expect, it, vi } from "vitest";
import type { CommentView } from "../queries/comments.js";
import { createCommentPublisher } from "./comments.js";

const T = "0x00000000000000000000000000000000000000B7";
const comment: CommentView = { id: "12", author: "0x00000000000000000000000000000000000000a1", username: "alice", body: "<b>hi</b>", createdAt: 1_700_000_000n };

describe("createCommentPublisher", () => {
  it("publishes a comment to the token's channel, as a comment event, with every number a string", async () => {
    const publish = vi.fn(async () => 1);
    await createCommentPublisher(publish)("sepolia", T, comment);
    expect(publish).toHaveBeenCalledOnce();
    const [channel, raw] = publish.mock.calls[0]! as unknown as [string, string];
    expect(channel).toBe(`token:sepolia:${T.toLowerCase()}`);
    expect(JSON.parse(raw)).toEqual({
      type: "comment",
      id: "12",
      chain: "sepolia",
      token: T.toLowerCase(),
      author: comment.author,
      username: "alice",
      body: "<b>hi</b>",
      createdAt: "1700000000",
    });
  });

  it("leaves out what is absent instead of publishing nulls", async () => {
    const publish = vi.fn(async () => 1);
    await createCommentPublisher(publish)("sepolia", T, { ...comment, username: undefined });
    const message = JSON.parse((publish.mock.calls[0]! as unknown as [string, string])[1]);
    expect("username" in message).toBe(false);
    expect("avatarUrl" in message).toBe(false);
  });

  it("does not throw when Redis is down: a comment is saved whether or not anyone is told live", async () => {
    const errors: unknown[] = [];
    const publish = createCommentPublisher(async () => {
      throw new Error("ECONNREFUSED");
    }, (e) => errors.push(e));
    await expect(publish("sepolia", T, comment)).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it("does nothing at all when there is no Redis configured", async () => {
    await expect(createCommentPublisher(undefined)("sepolia", T, comment)).resolves.toBeUndefined();
  });
});
