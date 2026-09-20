import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { ApiError } from "@/lib/api";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { EditProfile } from "./edit-profile";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The client itself is tested on its own (lib/profile/client.test.ts, in node: jsdom's FormData does not survive a fetch).
const client = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/profile/client", () => ({ getProfileApi: () => client }));
vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useSignMessage: () => ({ signMessageAsync: vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`) }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  router.refresh.mockReset();
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

const OTHER = "0x00000000000000000000000000000000000000ff";

/** The API for someone signed in (or not), and what the client was asked to change. */
function fakeApi(opts: { session?: string; put?: { status: number; body: unknown } } = {}) {
  const state = { me: 0, puts: [] as Record<string, string>[] };
  server.use(
    http.get(`${API}/me`, () => {
      state.me += 1;
      return opts.session
        ? HttpResponse.json({ address: opts.session, admin: false })
        : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 });
    }),
  );
  client.update.mockReset().mockImplementation(async (changes: { username?: string; avatar?: File; removeAvatar?: boolean }) => {
    const fields: Record<string, string> = {};
    if (changes.username !== undefined) fields.username = changes.username;
    if (changes.avatar) fields.avatar = `file:${changes.avatar.name}:${changes.avatar.type}:${changes.avatar.size}`;
    if (changes.removeAvatar) fields.removeAvatar = "true";
    state.puts.push(fields);
    const r = opts.put ?? { status: 200, body: { address: TEST_USER } };
    if (r.status >= 400) throw new ApiError(r.status, (r.body as { error: string }).error, "server text that is not shown");
    return r.body;
  });
  return state;
}

async function show(address: string, current: { username?: string; avatarUrl?: string } = {}, connected = true) {
  const wallet = renderWithWallet(<EditProfile address={address} current={current} />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}
const open = async () => userEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
const nameBox = () => screen.getByRole("textbox", { name: "Username" });
const save = () => screen.getByRole("button", { name: "Save" });
const quiet = () => act(() => new Promise((r) => setTimeout(r, 40)));
const picture = (bytes = 100, type = "image/png", name = "me.png") => new File([new Uint8Array(bytes)], name, { type });
const choose = (file: File) => fireEvent.change(screen.getByLabelText("Picture"), { target: { files: [file] } });

describe("EditProfile: who sees it", () => {
  it("is drawn for the owner of the address when signed in", async () => {
    fakeApi({ session: TEST_USER });
    await show(TEST_USER);
    expect(await screen.findByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("is absent for someone else's profile, for a stranger with no wallet, and for a wallet with no session", async () => {
    const a = fakeApi({ session: TEST_USER });
    const other = await show(OTHER);
    await quiet();
    expect(other.container.innerHTML).toBe("");
    expect(a.me).toBeGreaterThan(0);
    other.unmount();
    localStorage.clear();
    fakeApi({ session: TEST_USER });
    const nobody = await show(TEST_USER, {}, false);
    await quiet();
    expect(nobody.container.innerHTML).toBe("");
    nobody.unmount();
    localStorage.clear();
    fakeApi({});
    const signedOut = await show(TEST_USER);
    await quiet();
    expect(signedOut.container.innerHTML).toBe("");
  });
});

describe("EditProfile: the form", () => {
  it("opens with the current username filled in, and Save waiting for a change", async () => {
    fakeApi({ session: TEST_USER });
    await show(TEST_USER, { username: "alice" });
    await open();
    expect(nameBox()).toHaveValue("alice");
    expect(save()).toBeDisabled();
  });

  it("saves a new username, sending only the username, then refreshes the page", async () => {
    const api = fakeApi({ session: TEST_USER, put: { status: 200, body: { address: TEST_USER, username: "bob" } } });
    await show(TEST_USER, { username: "alice" });
    await open();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), "bob");
    await userEvent.click(save());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(api.puts).toEqual([{ username: "bob" }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("clears the username when it is emptied", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show(TEST_USER, { username: "alice" });
    await open();
    await userEvent.clear(nameBox());
    await userEvent.click(save());
    await waitFor(() => expect(api.puts).toEqual([{ username: "" }]));
  });

  it("will not save a name the server would refuse, and says what a name may be", async () => {
    fakeApi({ session: TEST_USER });
    await show(TEST_USER);
    await open();
    for (const bad of ["ab", "has space", "<b>x</b>", "a".repeat(21), "0x1a2b3c4d"]) {
      await userEvent.clear(nameBox());
      await userEvent.type(nameBox(), bad);
      expect(save(), bad).toBeDisabled();
    }
    expect(screen.getByText(/3 to 20 letters, digits or underscores/)).toBeInTheDocument();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), "good_name9");
    expect(save()).toBeEnabled();
  });

  it("trims the spaces around a pasted name", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show(TEST_USER);
    await open();
    await userEvent.type(nameBox(), "  alice  ");
    await userEvent.click(save());
    await waitFor(() => expect(api.puts).toEqual([{ username: "alice" }]));
  });

  it("sends a chosen picture as a file, and not the name when that was left alone", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show(TEST_USER, { username: "alice" });
    await open();
    choose(picture(100, "image/png", "me.png"));
    await userEvent.click(save());
    await waitFor(() => expect(api.puts).toEqual([{ avatar: "file:me.png:image/png:100" }]));
  });

  it("refuses a picture that is too big or not an image before sending anything", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show(TEST_USER);
    await open();
    choose(picture(2 * 1024 * 1024 + 1));
    expect(await screen.findByRole("alert")).toHaveTextContent("That picture is over 2 MB.");
    expect(save()).toBeDisabled();
    choose(picture(100, "image/svg+xml", "x.svg"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a PNG, JPEG or WebP picture.");
    expect(save()).toBeDisabled();
    expect(api.puts).toEqual([]);
  });

  it("removes the picture when asked, offered only when there is one", async () => {
    const api = fakeApi({ session: TEST_USER });
    const first = await show(TEST_USER, {});
    await open();
    expect(screen.queryByRole("checkbox", { name: "Remove my picture" })).toBeNull();
    first.unmount();
    localStorage.clear();
    await show(TEST_USER, { avatarUrl: "https://gw.example/ipfs/x" });
    await open();
    await userEvent.click(screen.getByRole("checkbox", { name: "Remove my picture" }));
    await userEvent.click(save());
    await waitFor(() => expect(api.puts).toEqual([{ removeAvatar: "true" }]));
  });

  it.each([
    [409, "username_taken", "That username is taken."],
    [400, "bad_username", "Use 3 to 20 letters, digits or underscores, and not something that looks like an address."],
    [400, "bad_image", "That picture could not be used. Choose a PNG, JPEG or WebP image."],
    [429, "rate_limited", "You have changed your profile a lot recently. Please try again later."],
    [403, "banned", "You cannot change this profile."],
    [500, "internal", "That did not work. Please try again."],
  ])("explains a %s (%s) in words, keeps what was typed and stays open", async (status, code, words) => {
    fakeApi({ session: TEST_USER, put: { status, body: { error: code, message: "server text that is not shown" } } });
    await show(TEST_USER);
    await open();
    await userEvent.type(nameBox(), "alice");
    await userEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent(words);
    expect(nameBox()).toHaveValue("alice");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("sends once however fast Save is clicked", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show(TEST_USER);
    await open();
    await userEvent.type(nameBox(), "alice");
    const button = save();
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(api.puts).toHaveLength(1);
  });
});
