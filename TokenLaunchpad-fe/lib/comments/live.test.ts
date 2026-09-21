import { describe, expect, it } from "vitest";
import type { Comment } from "../types";
import { liveCommentSchema, mergeComments, newerThan, reachesBack } from "./live";

const ADDR = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const wire = (o: Record<string, unknown> = {}) => ({
  type: "comment",
  id: "5",
  chain: "sepolia",
  token: ADDR(0xb2),
  author: ADDR(0xa1),
  body: "hi",
  createdAt: "1700000000",
  ...o,
});
const c = (id: number, body = `c${id}`): Comment => ({ id: String(id), author: ADDR(1), body, createdAt: 1n });

describe("liveCommentSchema", () => {
  it("accepts what the API publishes, with the time as a bigint and the token in lower case", () => {
    const parsed = liveCommentSchema.parse(
      wire({ token: ADDR(0xb2).toUpperCase().replace("0X", "0x"), username: "bob", avatarUrl: "https://gw/x" }),
    );
    expect(parsed).toMatchObject({
      id: "5",
      token: ADDR(0xb2),
      author: ADDR(0xa1),
      username: "bob",
      body: "hi",
      createdAt: 1_700_000_000n,
    });
  });

  it("drops what is malformed: wrong type, a non-numeric id, a bad time, an author that is not an address, no body", () => {
    for (const bad of [
      { type: "trade" },
      { id: "abc" },
      { id: 5 },
      { createdAt: "-1" },
      { author: "bob" },
      { token: "x" },
      { body: undefined },
      { body: 7 },
    ]) {
      expect(liveCommentSchema.safeParse(wire(bad)).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("mergeComments", () => {
  it("lists the newest first, whatever order they arrived in", () => {
    expect(mergeComments([c(2), c(1)], [c(3)]).map((x) => x.id)).toEqual(["3", "2", "1"]);
  });

  it("lists a comment once however many ways it arrived (the author's own post and the socket's copy are one)", () => {
    expect(mergeComments([c(2)], [c(3), c(3), c(2)]).map((x) => x.id)).toEqual(["3", "2"]);
  });

  it("orders by number, not by text: 10 is newer than 9", () => {
    expect(mergeComments([c(9)], [c(10)]).map((x) => x.id)).toEqual(["10", "9"]);
  });

  it("prefers what the server listed over a live copy of the same comment", () => {
    expect(mergeComments([c(2, "from server")], [c(2, "from socket")])[0]!.body).toBe("from server");
  });

  it("never changes what it was given", () => {
    const a = [c(1)];
    mergeComments(a, [c(2)]);
    expect(a).toHaveLength(1);
  });
});

describe("newerThan", () => {
  it("keeps only what is newer than everything the server just listed: the rest is the server's to say (it may have been hidden)", () => {
    expect(newerThan([c(3), c(8), c(6)], [c(5), c(4)]).map((x) => x.id)).toEqual(["8", "6"]);
  });

  it("keeps everything when the server listed nothing", () => {
    expect(newerThan([c(1)], []).map((x) => x.id)).toEqual(["1"]);
  });
});

describe("reachesBack", () => {
  it("is true when the new first page overlaps the old one: nothing can have fallen between them", () => {
    expect(reachesBack([c(100), c(71)], [c(105), c(80)])).toBe(true);
    expect(reachesBack([c(100), c(71)], [c(100), c(71)])).toBe(true);
  });

  it("is false when the new page starts above everything the old one had: comments in between are unseen", () => {
    expect(reachesBack([c(100), c(71)], [c(130), c(101)])).toBe(false);
  });

  it("is true when either page is empty: there is no gap to speak of", () => {
    expect(reachesBack([], [c(5)])).toBe(true);
    expect(reachesBack([c(5)], [])).toBe(true);
  });
});
