import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../test/msw/handlers";
import { server } from "../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../test/wallet";
import { ConnectButton } from "./connect-button";
import { SideNav } from "./side-nav";

const nav = vi.hoisted(() => ({ pathname: "/sepolia" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  nav.pathname = "/sepolia";
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

interface Options {
  connected?: boolean;
  session?: { address: string; admin: boolean };
}

async function show({ connected = false, session }: Options = {}) {
  server.use(http.get(`${API}/me`, () => (session ? HttpResponse.json(session) : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 }))));
  const wallet = renderWithWallet(<SideNav chain="sepolia" />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));
const current = () => screen.queryAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.getAttribute("href"));

describe("the side navigation", () => {
  it("is one labelled navigation with a link home, Discover and Create token, each under this chain", async () => {
    await show();
    const region = screen.getByRole("navigation", { name: "Main" });
    expect(within(region).getByRole("link", { name: "Vezta Launchpad" })).toHaveAttribute("href", "/sepolia");
    expect(within(region).getByRole("link", { name: "Discover" })).toHaveAttribute("href", "/sepolia");
    expect(within(region).getByRole("link", { name: "Create token" })).toHaveAttribute("href", "/sepolia/create");
  });

  it("lists the watchlist for everyone, logged in or not: that page says what to do when nobody is", async () => {
    await show();
    expect(screen.getByRole("link", { name: "Watchlist" })).toHaveAttribute("href", "/sepolia/watchlist");
  });

  it("lists Positions for everyone: the page itself says to connect a wallet when there is none", async () => {
    await show();
    expect(screen.getByRole("link", { name: "Positions" })).toHaveAttribute("href", "/sepolia/positions");
  });

  it("puts the pages in the order a person reaches for them: Discover, Watchlist, Positions, Create token, Profile", async () => {
    await show();
    const order = within(screen.getByRole("navigation", { name: "Main" }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(order).toEqual(["Discover", "Watchlist", "Positions", "Create token", "Profile"]);
  });

  it("names each page in words, so the expanded rail and a screen reader say the same thing", async () => {
    await show();
    for (const name of ["Discover", "Create token"]) expect(screen.getByRole("link", { name })).toHaveTextContent(name); // in the page, not only in an attribute
  });

  describe("Profile", () => {
    it("is offered before anyone is connected, as a button that asks them to connect: there is no profile to go to yet", async () => {
      await show();
      await settle();
      expect(screen.queryByRole("link", { name: "Profile" })).toBeNull();
      expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    });

    it("opens what the header's connect button opens when it is pressed", async () => {
      const wallet = renderWithWallet(
        <>
          <SideNav chain="sepolia" />
          <ConnectButton />
        </>,
      );
      server.use(http.get(`${API}/me`, () => HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 })));
      expect(screen.queryByRole("dialog")).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: "Profile" }));
      expect(await screen.findByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
      wallet.unmount();
    });

    it("does nothing, and does not fail, when the page has no way to connect", async () => {
      await show();
      await userEvent.click(screen.getByRole("button", { name: "Profile" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("becomes a link to the wallet's own profile the moment one is connected, and no longer a button", async () => {
      const wallet = await show();
      await settle();
      expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
      await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
      expect(await screen.findByRole("link", { name: "Profile" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Profile" })).toBeNull();
    });

    it("goes to the connected wallet's own profile once one is connected", async () => {
      await show({ connected: true });
      const link = await screen.findByRole("link", { name: "Profile" });
      expect(link.getAttribute("href")!.toLowerCase()).toBe(`/sepolia/profile/${TEST_USER}`);
    });
  });

  describe("Admin", () => {
    it("is offered to a signed-in admin, and goes to this chain's admin page", async () => {
      await show({ connected: true, session: { address: TEST_USER, admin: true } });
      expect(await screen.findByRole("link", { name: "Admin" })).toHaveAttribute("href", "/sepolia/admin");
    });

    it("is not offered to someone signed in who is not an admin, to someone with no session, or to a session for another address", async () => {
      for (const session of [{ address: TEST_USER, admin: false }, undefined, { address: "0x00000000000000000000000000000000000000ff", admin: true }]) {
        const { unmount } = await show({ connected: true, session });
        await settle();
        expect(screen.queryByRole("link", { name: "Admin" }), JSON.stringify(session)).toBeNull();
        unmount();
      }
    });
  });

  describe("which page is open", () => {
    const at = async (pathname: string, options?: Options) => {
      nav.pathname = pathname;
      await show(options);
      await settle();
      return current();
    };

    it("marks Discover on the discover page, and on a token's page, which is inside it", async () => {
      expect(await at("/sepolia")).toEqual(["/sepolia"]);
    });

    it("marks Discover on a token's page", async () => {
      expect(await at("/sepolia/token/0x00000000000000000000000000000000000000b2")).toEqual(["/sepolia"]);
    });

    it("still knows the page when the address ends in a slash", async () => {
      expect(await at("/sepolia/create/")).toEqual(["/sepolia/create"]);
    });

    it("marks Positions on its page, whichever view is open", async () => {
      expect(await at("/sepolia/positions")).toEqual(["/sepolia/positions"]);
    });

    it("marks Watchlist on its page, and not Discover", async () => {
      expect(await at("/sepolia/watchlist")).toEqual(["/sepolia/watchlist"]);
    });

    it("marks Create token on the create page, and not Discover", async () => {
      expect(await at("/sepolia/create")).toEqual(["/sepolia/create"]);
    });

    it("marks Profile on a profile page", async () => {
      const marked = await at(`/sepolia/profile/${TEST_USER}`, { connected: true });
      expect(marked).toHaveLength(1);
      expect(marked[0]!.toLowerCase()).toBe(`/sepolia/profile/${TEST_USER}`);
    });

    it("marks Admin on the admin page", async () => {
      expect(await at("/sepolia/admin", { connected: true, session: { address: TEST_USER, admin: true } })).toEqual(["/sepolia/admin"]);
    });

    it("marks nothing for a page it does not list, and never marks two at once", async () => {
      expect(await at("/sepolia/somewhere-else")).toEqual([]);
      expect(await at("/sepolia/createx")).toEqual([]);
    });

    it("does not mark Discover on another chain's page", async () => {
      expect(await at("/mainnet")).toEqual([]);
    });
  });
});
