import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { Comment } from "@/lib/types";
import { fakeLiveClient } from "../../test/fake-live-client";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { CommentList } from "./comment-list";

const api = vi.hoisted(() => ({ comments: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), api }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// Signing is the wallet's job; wagmi's mock connector forwards it to a live RPC, which cannot run under jsdom.
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useSignMessage: () => ({ signMessageAsync: vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`) }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  api.comments.mockReset();
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

const TOKEN = "0x00000000000000000000000000000000000000b2";
const ROOM = `token:sepolia:${TOKEN}`;
const NOW = 1_700_000_100;
const c = (id: number, body = `comment ${id}`): Comment => ({
  id: String(id),
  author: "0x00000000000000000000000000000000000000a9",
  body,
  createdAt: 1_700_000_000n,
});
const wire = (id: number, body = `comment ${id}`, over: Record<string, unknown> = {}) => ({
  type: "comment",
  id: String(id),
  chain: "sepolia",
  token: TOKEN,
  author: "0x00000000000000000000000000000000000000a9",
  body,
  createdAt: "1700000000",
  ...over,
});
const bodies = () => screen.queryAllByTestId("comment-body").map((el) => el.textContent);

/** The API's sign-in and comment endpoints, for someone with (or without) a session. */
function sessionApi(session?: string, admin = false) {
  const posted: unknown[] = [];
  server.use(
    http.get(`${API}/me`, () =>
      session
        ? HttpResponse.json({ address: session, admin })
        : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 }),
    ),
    http.post(`${API}/sepolia/tokens/:address/comments`, async ({ request }) => {
      const { body } = (await request.json()) as { body: string };
      posted.push(body);
      return HttpResponse.json({ id: "50", author: TEST_USER, body, createdAt: "1700000090" }, { status: 201 });
    }),
  );
  return posted;
}

async function setup(props: { initial?: Comment[]; nextCursor?: string; connected?: boolean } = {}) {
  const fake = fakeLiveClient();
  const wallet = renderWithWallet(
    <CommentList
      chain="sepolia"
      token={TOKEN}
      initial={props.initial ?? []}
      nextCursor={props.nextCursor}
      now={NOW}
      client={fake.client}
    />,
  );
  if (props.connected ?? true) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return { fake, ...wallet };
}

describe("CommentList: what it shows", () => {
  it("shows the empty state, not a spinner, when there are no comments", async () => {
    sessionApi();
    await setup();
    expect(screen.getByText("No comments yet. Be the first to say something.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("lists the comments it was given, newest first as served", async () => {
    sessionApi();
    await setup({ initial: [c(3), c(2), c(1)] });
    expect(bodies()).toEqual(["comment 3", "comment 2", "comment 1"]);
    expect(screen.queryByText(/No comments yet/)).toBeNull();
  });

  it("links each author to their profile on this chain", async () => {
    sessionApi();
    await setup({ initial: [c(1)] });
    expect(screen.getByRole("link", { name: "0x0000…00a9" })).toHaveAttribute("href", "/sepolia/profile/0x00000000000000000000000000000000000000a9");
  });

  it("listens to its token's room, named in lower case", async () => {
    sessionApi();
    const { fake } = await setup();
    expect(fake.rooms()).toEqual([ROOM]);
  });

  it("asks a stranger to connect, and a connected wallet without a session to sign in", async () => {
    sessionApi();
    const first = await setup({ connected: false });
    expect(screen.getByText("Connect a wallet to join the conversation.")).toBeInTheDocument();
    first.unmount();
    await setup();
    expect(await screen.findByText("Sign in to join the conversation.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("offers the box to someone signed in", async () => {
    sessionApi(TEST_USER);
    await setup();
    expect(await screen.findByRole("textbox", { name: "Comment" })).toBeInTheDocument();
  });
});

describe("CommentList: live", () => {
  it("shows a comment from another browser the moment it arrives, on top", async () => {
    sessionApi();
    const { fake } = await setup({ initial: [c(1)] });
    act(() => fake.message(ROOM, wire(2, "from elsewhere")));
    expect(bodies()).toEqual(["from elsewhere", "comment 1"]);
  });

  it("shows a live comment once, however many times it is delivered (a reorg or a retry)", async () => {
    sessionApi();
    const { fake } = await setup();
    act(() => {
      fake.message(ROOM, wire(2));
      fake.message(ROOM, wire(2));
    });
    expect(bodies()).toEqual(["comment 2"]);
  });

  it("draws a live comment as text, like any other", async () => {
    sessionApi();
    const { fake } = await setup();
    act(() => fake.message(ROOM, wire(2, "<img src=x onerror=alert(1)>")));
    expect(bodies()).toEqual(["<img src=x onerror=alert(1)>"]);
    expect(document.querySelector("img")).toBeNull();
  });

  it("drops what is not a comment, and a comment for another token", async () => {
    sessionApi();
    const { fake } = await setup();
    act(() => {
      fake.message(ROOM, wire(2, "x", { id: "abc" }));
      fake.message(ROOM, { type: "comment", chain: "sepolia", token: TOKEN, body: 5 });
      fake.message(ROOM, wire(3, "wrong token", { token: "0x00000000000000000000000000000000000000ff" }));
      fake.message(ROOM, { type: "trade" });
    });
    expect(bodies()).toEqual([]);
  });

  it("refetches after a reconnect, and the server's list is then the truth: a comment hidden meanwhile is gone", async () => {
    sessionApi();
    api.comments.mockResolvedValue({ items: [c(3)] });
    const { fake } = await setup({ initial: [c(2), c(1)] });
    act(() => fake.message(ROOM, wire(2, "live copy")));
    await act(async () => fake.reconnect());
    await waitFor(() => expect(bodies()).toEqual(["comment 3"]));
    expect(api.comments).toHaveBeenCalledWith("sepolia", TOKEN, expect.objectContaining({ limit: 30 }));
  });

  it("keeps a comment that arrived while the refetch was in flight and is not in its answer yet", async () => {
    sessionApi();
    let answer!: (page: { items: Comment[] }) => void;
    api.comments.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { fake } = await setup({ initial: [c(1)] });
    await act(async () => fake.reconnect());
    act(() => fake.message(ROOM, wire(9, "arrived meanwhile")));
    await act(async () => answer({ items: [c(1)] }));
    expect(bodies()).toEqual(["arrived meanwhile", "comment 1"]);
  });

  it("keeps the older comments someone loaded when the first page is refreshed, so the list does not shrink under them", async () => {
    sessionApi();
    api.comments.mockResolvedValueOnce({ items: [c(2), c(1)] }).mockResolvedValueOnce({ items: [c(4), c(3)], nextCursor: "cur1" });
    const { fake } = await setup({ initial: [c(4), c(3)], nextCursor: "cur1" });
    await userEvent.click(screen.getByRole("button", { name: "Show older comments" }));
    await waitFor(() => expect(bodies()).toHaveLength(4));
    await act(async () => fake.reconnect());
    await waitFor(() => expect(api.comments).toHaveBeenCalledTimes(2));
    expect(bodies()).toEqual(["comment 4", "comment 3", "comment 2", "comment 1"]);
  });

  it("starts again from the refreshed first page when a burst of new comments could have left a gap under it", async () => {
    sessionApi();
    api.comments.mockResolvedValueOnce({ items: [c(2), c(1)] }).mockResolvedValueOnce({ items: [c(9), c(8)], nextCursor: "cur9" });
    const { fake } = await setup({ initial: [c(4), c(3)], nextCursor: "cur1" });
    await userEvent.click(screen.getByRole("button", { name: "Show older comments" }));
    await waitFor(() => expect(bodies()).toHaveLength(4));
    await act(async () => fake.reconnect());
    await waitFor(() => expect(bodies()).toEqual(["comment 9", "comment 8"]));
    expect(screen.getByRole("button", { name: "Show older comments" })).toBeInTheDocument(); // paging resumes from the new page's cursor
  });

  it("keeps working when a refetch fails: what is on screen stays", async () => {
    sessionApi();
    api.comments.mockRejectedValue(new ApiError(0, "network", "x"));
    const { fake } = await setup({ initial: [c(1)] });
    await act(async () => fake.reconnect());
    expect(bodies()).toEqual(["comment 1"]);
  });
});

describe("CommentList: writing", () => {
  it("posts, shows the comment at once, and clears the box", async () => {
    const posted = sessionApi(TEST_USER);
    await setup({ initial: [c(1)] });
    await userEvent.type(await screen.findByRole("textbox", { name: "Comment" }), "hello world");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(bodies()).toEqual(["hello world", "comment 1"]));
    expect(posted).toEqual(["hello world"]);
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("");
  });

  it("does not show the author's own comment twice when the socket delivers it too", async () => {
    sessionApi(TEST_USER);
    const { fake } = await setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Comment" }), "mine");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(bodies()).toEqual(["mine"]));
    act(() => fake.message(ROOM, wire(50, "mine", { author: TEST_USER })));
    expect(bodies()).toEqual(["mine"]);
  });

  it("does not show it twice when the socket is quicker than the reply", async () => {
    sessionApi(TEST_USER);
    const { fake } = await setup();
    act(() => fake.message(ROOM, wire(50, "mine", { author: TEST_USER })));
    await userEvent.type(await screen.findByRole("textbox", { name: "Comment" }), "mine");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue(""));
    expect(bodies()).toEqual(["mine"]);
  });

  it("says why when the server refuses, and keeps the words", async () => {
    sessionApi(TEST_USER);
    server.use(
      http.post(`${API}/sepolia/tokens/:address/comments`, () => HttpResponse.json({ error: "banned", message: "x" }, { status: 403 })),
    );
    await setup();
    await userEvent.type(await screen.findByRole("textbox", { name: "Comment" }), "let me in");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You cannot post here.");
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveValue("let me in");
    expect(bodies()).toEqual([]);
  });
});

describe("CommentList: older comments", () => {
  it("shows no button when there is nothing older", async () => {
    sessionApi();
    await setup({ initial: [c(1)] });
    expect(screen.queryByRole("button", { name: "Show older comments" })).toBeNull();
  });

  it("loads the next page with the cursor, adds it below, and removes the button when that was the last", async () => {
    sessionApi();
    api.comments.mockResolvedValue({ items: [c(2), c(1)] });
    await setup({ initial: [c(4), c(3)], nextCursor: "cur1" });
    await userEvent.click(screen.getByRole("button", { name: "Show older comments" }));
    await waitFor(() => expect(bodies()).toEqual(["comment 4", "comment 3", "comment 2", "comment 1"]));
    expect(api.comments).toHaveBeenCalledWith("sepolia", TOKEN, expect.objectContaining({ cursor: "cur1" }));
    expect(screen.queryByRole("button", { name: "Show older comments" })).toBeNull();
  });

  it("drops an older page that arrives after the thread was started over, so it is never glued under the wrong comments", async () => {
    sessionApi();
    let older!: (page: { items: Comment[] }) => void;
    api.comments
      .mockReturnValueOnce(new Promise((resolve) => (older = resolve)))
      .mockResolvedValueOnce({ items: [c(9), c(8)], nextCursor: "cur9" });
    const { fake } = await setup({ initial: [c(4), c(3)], nextCursor: "cur1" });
    await userEvent.click(screen.getByRole("button", { name: "Show older comments" }));
    await act(async () => fake.reconnect()); // a burst of new comments: the thread starts over from cursor 9
    await waitFor(() => expect(bodies()).toEqual(["comment 9", "comment 8"]));
    await act(async () => older({ items: [c(2), c(1)] }));
    expect(bodies()).toEqual(["comment 9", "comment 8"]);
  });

  it("keeps the button, and says so, when the page could not be loaded", async () => {
    sessionApi();
    api.comments.mockRejectedValue(new ApiError(500, "internal", "x"));
    await setup({ initial: [c(2)], nextCursor: "cur1" });
    await userEvent.click(screen.getByRole("button", { name: "Show older comments" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show older comments" })).toBeEnabled();
    expect(within(screen.getByRole("alert")).queryByText(/internal/)).toBeNull(); // the server's own text is never shown
  });
});

describe("CommentList: moderation", () => {
  const hideRoute = (hidden: string[]) =>
    server.use(
      http.post(
        `${API}/sepolia/admin/comments/:id/hide`,
        ({ params }) => (hidden.push(String(params.id)), HttpResponse.json({ id: params.id, hidden: true })),
      ),
    );

  it("puts no hide control beside a comment for someone who is not an admin", async () => {
    sessionApi(TEST_USER, false);
    await setup({ initial: [c(2), c(1)] });
    await screen.findByRole("textbox", { name: "Comment" }); // the session is known by now
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
  });

  it("puts one beside each comment for an admin, and hiding one takes it off the list at once, leaving the others", async () => {
    const hidden: string[] = [];
    sessionApi(TEST_USER, true);
    hideRoute(hidden);
    await setup({ initial: [c(2), c(1)] });
    const buttons = await screen.findAllByRole("button", { name: "Hide" });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]!);
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(bodies()).toEqual(["comment 1"]));
    expect(hidden).toEqual(["2"]);
  });

  it("does not bring a hidden comment back when a stale copy of it arrives", async () => {
    const hidden: string[] = [];
    sessionApi(TEST_USER, true);
    hideRoute(hidden);
    const { fake } = await setup({ initial: [c(2)] });
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(bodies()).toEqual([]));
    act(() => fake.message(ROOM, wire(2)));
    expect(bodies()).toEqual([]);
  });
});
