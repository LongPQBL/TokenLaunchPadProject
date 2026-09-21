import { act, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { AdminLink } from "./admin-link";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

async function show(me: { address: string; admin: boolean } | undefined, connected = true) {
  server.use(http.get(`${API}/me`, () => (me ? HttpResponse.json(me) : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 }))));
  const wallet = renderWithWallet(<AdminLink chain="sepolia" />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
}

describe("the Admin link in the header", () => {
  it("is drawn for a signed-in admin, and goes to this chain's admin page", async () => {
    await show({ address: TEST_USER, admin: true });
    expect(await screen.findByRole("link", { name: "Admin" })).toHaveAttribute("href", "/sepolia/admin");
  });

  it("is not drawn for someone signed in who is not an admin", async () => {
    await show({ address: TEST_USER, admin: false });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("is not drawn without a session, or without a connected wallet", async () => {
    await show(undefined);
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("is not drawn for a session that belongs to another address than the connected wallet", async () => {
    await show({ address: "0x00000000000000000000000000000000000000ff", admin: true });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole("link", { name: "Admin" })).toBeNull();
  });
});
