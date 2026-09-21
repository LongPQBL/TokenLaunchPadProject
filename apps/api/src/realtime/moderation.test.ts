import { describe, expect, it } from "vitest";
import { createModerationPublisher } from "./moderation.js";

const TOKEN = "0x00000000000000000000000000000000000000B1";

function capture() {
  const sent: { channel: string; message: unknown }[] = [];
  const publish = async (channel: string, message: string) => void sent.push({ channel, message: JSON.parse(message) });
  return { sent, publish };
}

describe("the moderation publisher", () => {
  it("tells the discover grid, the trade strip and the token's own page that a token was hidden", async () => {
    const { sent, publish } = capture();
    await createModerationPublisher(publish)({ type: "token_hidden", chain: "sepolia", token: TOKEN });
    const message = { type: "token_hidden", chain: "sepolia", token: TOKEN.toLowerCase() };
    expect(sent).toEqual([
      { channel: "tokens", message },
      { channel: "trades", message },
      { channel: `token:sepolia:${TOKEN.toLowerCase()}`, message },
    ]);
  });

  it("tells only the token's own page that comments were hidden, and says which", async () => {
    const { sent, publish } = capture();
    await createModerationPublisher(publish)({ type: "comments_hidden", chain: "sepolia", token: TOKEN, ids: ["4", "9"] });
    expect(sent).toEqual([{ channel: `token:sepolia:${TOKEN.toLowerCase()}`, message: { type: "comments_hidden", chain: "sepolia", token: TOKEN.toLowerCase(), ids: ["4", "9"] } }]);
  });

  it("does nothing when there is no Redis", async () => {
    await expect(createModerationPublisher(undefined)({ type: "token_hidden", chain: "sepolia", token: TOKEN })).resolves.toBeUndefined();
  });

  it("keeps going when one channel fails, reports it, and does not throw", async () => {
    const errors: unknown[] = [];
    const sent: string[] = [];
    const publish = async (channel: string) => {
      if (channel === "tokens") throw new Error("down");
      sent.push(channel);
    };
    await createModerationPublisher(publish, (e) => errors.push(e))({ type: "token_hidden", chain: "sepolia", token: TOKEN });
    expect(sent).toEqual(["trades", `token:sepolia:${TOKEN.toLowerCase()}`]);
    expect(errors).toHaveLength(1);
  });
});
