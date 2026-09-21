import { describe, expect, it } from "vitest";
import { commentLength, MAX_COMMENT_CHARS, neutraliseBidi } from "./comments";

const RLO = String.fromCharCode(0x202e);
const LRE = String.fromCharCode(0x202a);
const PDF = String.fromCharCode(0x202c);
const RLI = String.fromCharCode(0x2067);
const PDI = String.fromCharCode(0x2069);

describe("neutraliseBidi", () => {
  it("removes every explicit direction override, embedding and isolate, so a comment cannot flip what is around it", () => {
    for (const c of [RLO, LRE, PDF, RLI, PDI, String.fromCharCode(0x202b), String.fromCharCode(0x202d), String.fromCharCode(0x2066), String.fromCharCode(0x2068)]) {
      expect(neutraliseBidi(`a${c}b`), c.charCodeAt(0).toString(16)).toBe("ab");
    }
  });

  it("leaves ordinary text, other scripts and emoji alone", () => {
    for (const s of ["hello", "שלום", "مرحبا", "日本語", "😀 gm", "a\nb"]) expect(neutraliseBidi(s)).toBe(s);
  });

  it("is what a reader sees for the classic spoof: the reversed tail is just text", () => {
    expect(neutraliseBidi(`send to ${RLO}0xdead${PDF}`)).toBe("send to 0xdead");
  });
});

describe("commentLength", () => {
  it("counts as a person does: an emoji is one, and the ends are not counted", () => {
    expect(commentLength("😀".repeat(3))).toBe(3);
    expect(commentLength("  hi  ")).toBe(2);
    expect(commentLength("   ")).toBe(0);
  });

  it("agrees with the server's limit", () => {
    expect(MAX_COMMENT_CHARS).toBe(500);
  });
});
