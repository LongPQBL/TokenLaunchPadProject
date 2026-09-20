import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@/lib/types";
import { CommentForm } from "./comment-form";
import { CommentItem } from "./comment-item";

const AUTHOR = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b9f9f";
const base: Comment = { id: "7", author: AUTHOR, body: "gm", createdAt: 1_700_000_000n };
const NOW = 1_700_000_030;
const item = (o: Partial<Comment> = {}) => render(<CommentItem comment={{ ...base, ...o }} now={NOW} />);
const RLO = String.fromCharCode(0x202e);
const PDF = String.fromCharCode(0x202c);

describe("CommentItem", () => {
  it("renders markup in a comment as literal text", () => {
    item({ body: "<img src=x onerror=alert(1)>" });
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img[onerror]")).toBeNull();
  });

  it("renders a script tag and a javascript: link as text too, and links nothing", () => {
    item({ body: "<script>alert(1)</script> javascript:alert(2)" });
    expect(screen.getByTestId("comment-body")).toHaveTextContent("<script>alert(1)</script> javascript:alert(2)");
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("breaks a 500-character word instead of widening the page", () => {
    item({ body: "a".repeat(500) });
    expect(screen.getByTestId("comment-body")).toHaveClass("break-all");
  });

  it("keeps the author's line breaks", () => {
    item({ body: "one\ntwo" });
    expect(screen.getByTestId("comment-body")).toHaveClass("whitespace-pre-wrap");
  });

  it("neutralises right-to-left override characters, in the body and in a name", () => {
    item({ body: `pay ${RLO}0xdead${PDF} now`, username: `${RLO}nimda` });
    expect(screen.getByTestId("comment-body").textContent).toBe("pay 0xdead now");
    expect(screen.getByTestId("comment-author").textContent).toBe("nimda");
  });

  it("isolates the text's direction from the page around it", () => {
    item({ body: "שלום" });
    expect(screen.getByTestId("comment-body")).toHaveAttribute("dir", "auto");
  });

  it("shows a shortened address when the author has no username", () => {
    item();
    expect(screen.getByTestId("comment-author")).toHaveTextContent("0x1a2b…9f9f");
  });

  it("shows the username when there is one, and never as markup", () => {
    item({ username: "<b>bob</b>" });
    expect(screen.getByTestId("comment-author")).toHaveTextContent("<b>bob</b>");
    expect(document.querySelector("b")).toBeNull();
  });

  it("draws whatever controls it is given beside the comment, and nothing when it is given none", () => {
    const { unmount } = render(<CommentItem comment={base} now={NOW} actions={<button>Hide</button>} />);
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
    unmount();
    item();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows when it was written", () => {
    item();
    expect(screen.getByText("30s ago")).toBeInTheDocument();
  });

  it("draws an https avatar with no referrer, and any other kind of URL as the placeholder", () => {
    const { unmount } = item({ avatarUrl: "https://gw.example/ipfs/x" });
    const img = document.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://gw.example/ipfs/x");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    unmount();
    item({ avatarUrl: "javascript:alert(1)" });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByTestId("token-image-placeholder")).toBeInTheDocument();
  });
});

type FormProps = Partial<React.ComponentProps<typeof CommentForm>>;
const form = (o: FormProps = {}) => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onSignIn = vi.fn().mockResolvedValue(true);
  render(<CommentForm draftKey="sepolia:0xabc" state="signed-in" onSubmit={onSubmit} onSignIn={onSignIn} {...o} />);
  return { onSubmit, onSignIn };
};
const box = () => screen.getByRole("textbox", { name: "Comment" });

beforeEach(() => localStorage.clear());

describe("CommentForm", () => {
  it("asks a stranger to connect a wallet, and offers no box", () => {
    form({ state: "disconnected" });
    expect(screen.getByText("Connect a wallet to join the conversation.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows the sign-in prompt instead of the form when logged out, and the button signs in", async () => {
    const { onSignIn } = form({ state: "signed-out" });
    expect(screen.getByText("Sign in to join the conversation.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("says so when signing in fails, instead of doing nothing", async () => {
    const { ApiError } = await import("@/lib/api");
    form({ state: "signed-out", onSignIn: vi.fn().mockRejectedValue(new ApiError(0, "network", "x")) });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });

  it("shows the character counter, and turns the post button off past 500", async () => {
    form();
    expect(screen.getByText("0 / 500")).toBeInTheDocument();
    const post = screen.getByRole("button", { name: "Post" });
    expect(post).toBeDisabled(); // nothing to post yet
    await userEvent.click(box());
    await userEvent.paste("x".repeat(500));
    expect(screen.getByText("500 / 500")).toBeInTheDocument();
    expect(post).toBeEnabled();
    await userEvent.paste("y");
    expect(screen.getByText("501 / 500")).toBeInTheDocument();
    expect(post).toBeDisabled();
  });

  it("counts an emoji as one, as the server does", async () => {
    form();
    await userEvent.click(box());
    await userEvent.paste("😀".repeat(500));
    expect(screen.getByText("500 / 500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post" })).toBeEnabled();
  });

  it("does not let a blank comment be sent", async () => {
    const { onSubmit } = form();
    await userEvent.type(box(), "   ");
    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the text, then empties the box and forgets the draft", async () => {
    const { onSubmit } = form();
    await userEvent.type(box(), "hello there");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(onSubmit).toHaveBeenCalledWith("hello there");
    await waitFor(() => expect(box()).toHaveValue(""));
    expect(localStorage.getItem("vezta:comment-draft:sepolia:0xabc")).toBeNull();
  });

  it("keeps what was typed when posting fails, and says why", async () => {
    const { ApiError } = await import("@/lib/api");
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(429, "rate_limited", "x"));
    form({ onSubmit });
    await userEvent.type(box(), "keep me");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You are commenting too fast. Please wait a moment.");
    expect(box()).toHaveValue("keep me");
    expect(screen.getByRole("button", { name: "Post" })).toBeEnabled(); // and can be tried again
  });

  it.each([
    [403, "banned", "You cannot post here."],
    [400, "bad_comment", "That comment is too long."],
    [404, "not_found", "This token is no longer available."],
    [0, "network", "Could not reach the server. Your comment is still in the box."],
    [500, "internal", "Could not post your comment. Please try again."],
  ])("explains a %s (%s) refusal in words", async (status, code, words) => {
    const { ApiError } = await import("@/lib/api");
    form({ onSubmit: vi.fn().mockRejectedValue(new ApiError(status, code, "server text that is not shown")) });
    await userEvent.type(box(), "hi");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(words);
  });

  it("does not send twice on a double click", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    form({ onSubmit });
    await userEvent.type(box(), "once");
    const post = screen.getByRole("button", { name: "Post" });
    await userEvent.dblClick(post);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
  });

  it("keeps an unsent draft across a tab switch", async () => {
    const first = render(<CommentForm draftKey="sepolia:0xabc" state="signed-in" onSubmit={vi.fn()} onSignIn={vi.fn()} />);
    await userEvent.type(box(), "half a thou");
    first.unmount(); // the other tab is shown: this one is gone
    form();
    await waitFor(() => expect(box()).toHaveValue("half a thou"));
  });

  it("keeps drafts apart, one per token", async () => {
    const first = render(<CommentForm draftKey="sepolia:0xaaa" state="signed-in" onSubmit={vi.fn()} onSignIn={vi.fn()} />);
    await userEvent.type(box(), "for aaa");
    first.unmount();
    form({ draftKey: "sepolia:0xbbb" });
    expect(box()).toHaveValue("");
  });

  it("works without storage: a blocked or full localStorage is not an error", async () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    const { onSubmit } = form();
    await userEvent.type(box(), "still works");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(onSubmit).toHaveBeenCalledWith("still works");
    vi.restoreAllMocks();
  });
});
