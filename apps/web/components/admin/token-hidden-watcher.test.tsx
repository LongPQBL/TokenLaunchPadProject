import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeLiveClient } from "../../test/fake-live-client";
import { TokenHiddenWatcher } from "./token-hidden-watcher";

const TOKEN = "0x00000000000000000000000000000000000000b2";
const ROOM = `token:sepolia:${TOKEN}`;
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => refresh.mockReset());

const hidden = (over: Record<string, unknown> = {}) => ({ type: "token_hidden", chain: "sepolia", token: TOKEN, ...over });

describe("TokenHiddenWatcher", () => {
  it("asks the page to load again when this token is hidden, so the visitor is shown that it is gone instead of a thread that no longer loads", () => {
    const fake = fakeLiveClient();
    render(<TokenHiddenWatcher chain="sepolia" token={TOKEN} client={fake.client} />);
    act(() => fake.message(ROOM, hidden()));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does nothing for another token or chain, for other messages, or for a malformed one", () => {
    const fake = fakeLiveClient();
    render(<TokenHiddenWatcher chain="sepolia" token={TOKEN} client={fake.client} />);
    act(() => fake.message(ROOM, hidden({ token: "0x00000000000000000000000000000000000000b3" })));
    act(() => fake.message(ROOM, hidden({ chain: "mainnet" })));
    act(() => fake.message(ROOM, hidden({ token: "0x12" })));
    act(() => fake.message(ROOM, { type: "trade" }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("listens to this token's room and no other, and draws nothing", () => {
    const fake = fakeLiveClient();
    const { container } = render(<TokenHiddenWatcher chain="sepolia" token={TOKEN.toUpperCase().replace("0X", "0x")} client={fake.client} />);
    expect(fake.rooms()).toEqual([ROOM]);
    expect(container).toBeEmptyDOMElement();
  });
});
