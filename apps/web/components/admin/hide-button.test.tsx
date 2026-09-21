import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { HideCommentButton, HideTokenButton } from "./hide-button";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useSignMessage: () => ({ signMessageAsync: vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`) }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  router.push.mockReset();
  router.refresh.mockReset();
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

const TOKEN = "0x00000000000000000000000000000000000000b2";

/** The API as a person with (or without) a session, and as an admin or not. Records what was asked to be hidden. */
function fakeApi(who: { session?: string; admin?: boolean } = {}, hide: { status?: number; code?: string } = {}) {
  const state = { me: 0, hidden: [] as string[] };
  server.use(
    http.get(`${API}/me`, () => {
      state.me += 1;
      return who.session
        ? HttpResponse.json({ address: who.session, admin: who.admin ?? false })
        : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 });
    }),
    http.post(`${API}/sepolia/admin/tokens/:address/hide`, ({ params }) => {
      state.hidden.push(`token:${params.address}`);
      return hide.status
        ? HttpResponse.json({ error: hide.code ?? "internal", message: "x" }, { status: hide.status })
        : HttpResponse.json({ hidden: true });
    }),
    http.post(`${API}/sepolia/admin/comments/:id/hide`, ({ params }) => {
      state.hidden.push(`comment:${params.id}`);
      return hide.status
        ? HttpResponse.json({ error: hide.code ?? "internal", message: "x" }, { status: hide.status })
        : HttpResponse.json({ hidden: true });
    }),
  );
  return state;
}

async function show(ui: React.ReactElement, connected = true) {
  const wallet = renderWithWallet(ui);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}
/** Waits until the page has asked who is signed in and had time to act on the answer. */
const settled = async (api: { me: number }) => {
  await waitFor(() => expect(api.me).toBeGreaterThan(0));
  await act(() => new Promise((r) => setTimeout(r, 30)));
};

describe("who sees the hide button", () => {
  // Review Focus: absent from the DOM, not merely hidden with CSS.
  it("is absent from the page for a signed-in person who is not an admin", async () => {
    const api = fakeApi({ session: TEST_USER, admin: false });
    const { container } = await show(<HideTokenButton chain="sepolia" token={TOKEN} />);
    await settled(api);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.innerHTML).toBe("");
    expect(document.body.textContent).not.toMatch(/hide/i);
  });

  it("is absent for someone with no session, and for someone who has not connected a wallet", async () => {
    const anon = fakeApi({});
    const first = await show(<HideTokenButton chain="sepolia" token={TOKEN} />);
    await settled(anon);
    expect(first.container.innerHTML).toBe("");
    first.unmount();
    localStorage.clear(); // wagmi remembers a connection there, and would reconnect the next render by itself
    const none = fakeApi({ session: TEST_USER, admin: true });
    const second = await show(<HideTokenButton chain="sepolia" token={TOKEN} />, false);
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(second.container.innerHTML).toBe("");
    expect(none.me).toBe(0);
  });

  it("is absent beside a comment for a non-admin", async () => {
    const api = fakeApi({ session: TEST_USER, admin: false });
    const { container } = await show(<HideCommentButton chain="sepolia" id="7" onHidden={vi.fn()} />);
    await settled(api);
    expect(container.innerHTML).toBe("");
  });

  it("is there for an admin, on the token and beside a comment", async () => {
    fakeApi({ session: TEST_USER, admin: true });
    await show(
      <>
        <HideTokenButton chain="sepolia" token={TOKEN} />
        <HideCommentButton chain="sepolia" id="7" onHidden={vi.fn()} />
      </>,
    );
    expect(await screen.findByRole("button", { name: "Hide token" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});

describe("hiding a token", () => {
  const open = async () => {
    const api = fakeApi({ session: TEST_USER, admin: true });
    await show(<HideTokenButton chain="sepolia" token={TOKEN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hide token" }));
    return api;
  };

  it("asks first, because everyone will see it, and sends nothing until asked", async () => {
    const api = await open();
    expect(await screen.findByRole("dialog")).toHaveTextContent("Hide this token?");
    expect(api.hidden).toEqual([]);
  });

  it("does nothing on Cancel", async () => {
    const api = await open();
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.hidden).toEqual([]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("hides on confirmation, then leaves the page: a token that is gone must not be shown", async () => {
    const api = await open();
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/sepolia"));
    expect(api.hidden).toEqual([`token:${TOKEN}`]);
  });

  it("sends once however fast the confirmation is clicked", async () => {
    const api = await open();
    const confirm = await screen.findByRole("button", { name: "Hide" });
    // Both clicks land before React has drawn the first one's "busy" state: only the guard stands between them and two requests.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(api.hidden).toHaveLength(1);
  });

  it("stays on the page and says what went wrong, when the server refuses", async () => {
    fakeApi({ session: TEST_USER, admin: true }, { status: 404, code: "not_found" });
    await show(<HideTokenButton chain="sepolia" token={TOKEN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hide token" }));
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That is no longer there.");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hide" })).toBeEnabled(); // and can be tried again
  });

  it("hides a token whose address arrives in mixed case", async () => {
    const api = fakeApi({ session: TEST_USER, admin: true });
    await show(<HideTokenButton chain="sepolia" token={TOKEN.toUpperCase().replace("0X", "0x")} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hide token" }));
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await waitFor(() => expect(api.hidden).toHaveLength(1));
  });
});

describe("hiding a comment", () => {
  it("asks first, then hides it and tells the list, without leaving the page", async () => {
    const api = fakeApi({ session: TEST_USER, admin: true });
    const onHidden = vi.fn();
    await show(<HideCommentButton chain="sepolia" id="7" onHidden={onHidden} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Hide this comment?");
    expect(api.hidden).toEqual([]);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hide" }));
    await waitFor(() => expect(onHidden).toHaveBeenCalledWith("7"));
    expect(api.hidden).toEqual(["comment:7"]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not tell the list when the server refuses", async () => {
    fakeApi({ session: TEST_USER, admin: true }, { status: 500 });
    const onHidden = vi.fn();
    await show(<HideCommentButton chain="sepolia" id="7" onHidden={onHidden} />);
    await userEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Hide" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(onHidden).not.toHaveBeenCalled();
  });
});
