import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { AdminPanel } from "./admin-panel";

vi.mock("wagmi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wagmi")>()),
  useSignMessage: () => ({ signMessageAsync: vi.fn().mockResolvedValue(`0x${"11".repeat(65)}`) }),
}));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  vi.stubEnv("NEXT_PUBLIC_API_URL", API);
});
afterEach(() => vi.unstubAllEnvs());

const TOKEN = "0x00000000000000000000000000000000000000b2";
const wireHealth = (o: Record<string, unknown> = {}) => ({
  indexerLagBlocks: 2,
  watcherAliveSince: "1700000000",
  botAddress: "0x00000000000000000000000000000000000000b1",
  botBalance: "2000000000000000000",
  failedMetadataCount: 4,
  stuckTokens: [{ address: TOKEN, name: "Full", ticker: "FULL", completeSince: "1700000000" }],
  ...o,
});
const wireReport = {
  id: "4",
  token: TOKEN,
  name: "Spam",
  ticker: "SPM",
  reporter: "0x00000000000000000000000000000000000000a1",
  reason: "scam",
  createdAt: "1700000000",
  hidden: false,
};

/** The API as an admin (or not), counting every request made to the admin routes. */
function fakeApi(who: { session?: string; admin?: boolean } = {}, over: { health?: () => Response; reports?: () => Response } = {}) {
  const calls = { me: 0, health: 0, reports: 0, retry: 0, resolved: [] as string[] };
  server.use(
    http.get(`${API}/me`, () => {
      calls.me += 1;
      return who.session
        ? HttpResponse.json({ address: who.session, admin: who.admin ?? false })
        : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 });
    }),
    http.get(`${API}/sepolia/admin/health`, () => {
      calls.health += 1;
      return over.health?.() ?? HttpResponse.json(wireHealth());
    }),
    http.get(`${API}/sepolia/admin/reports`, () => {
      calls.reports += 1;
      return over.reports?.() ?? HttpResponse.json({ items: [wireReport] });
    }),
    http.post(`${API}/sepolia/admin/metadata/re-resolve`, () => {
      calls.retry += 1;
      return HttpResponse.json({ count: 4 });
    }),
    http.post(`${API}/sepolia/admin/reports/:id/resolve`, ({ params }) => {
      calls.resolved.push(String(params.id));
      return HttpResponse.json({ id: params.id, resolved: true });
    }),
  );
  return calls;
}

async function show(connected = true) {
  const wallet = renderWithWallet(<AdminPanel chain="sepolia" />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}
const quiet = () => act(() => new Promise((r) => setTimeout(r, 50)));

describe("AdminPanel: who sees it", () => {
  it("shows a signed-in non-admin only what any missing page shows, and asks the admin API nothing", async () => {
    const api = fakeApi({ session: TEST_USER, admin: false });
    await show();
    await waitFor(() => expect(api.me).toBeGreaterThan(0));
    await quiet();
    expect(screen.getByRole("alert")).toHaveTextContent("Page not found.");
    expect(screen.queryByText("System health")).toBeNull();
    expect(api.health + api.reports).toBe(0);
  });

  it("shows a stranger with no wallet the same, and asks nothing", async () => {
    const api = fakeApi({});
    await show(false);
    await quiet();
    expect(screen.getByRole("alert")).toHaveTextContent("Page not found.");
    expect(api.health + api.reports).toBe(0);
  });

  it("shows an admin the whole page", async () => {
    fakeApi({ session: TEST_USER, admin: true });
    await show();
    expect(await screen.findByLabelText("System health")).toBeInTheDocument();
    expect(await screen.findByText("Curves waiting to migrate")).toBeInTheDocument();
    expect(await screen.findByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Ban an address")).toBeInTheDocument();
    expect(screen.queryByText("Page not found.")).toBeNull();
  });
});

describe("AdminPanel: what an admin sees", () => {
  it("fills every section from the API", async () => {
    fakeApi({ session: TEST_USER, admin: true });
    await show();
    expect(await screen.findByText("2 blocks behind")).toBeInTheDocument();
    expect(screen.getByText("2 ETH")).toBeInTheDocument();
    expect(await screen.findByTestId("stuck-token")).toHaveTextContent("Full");
    expect(await screen.findByTestId("report-row")).toHaveTextContent("scam");
  });

  it("retries failed metadata and then reads the health again", async () => {
    const api = fakeApi({ session: TEST_USER, admin: true });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Retry all" }));
    expect(await screen.findByText("4 tokens will be resolved again.")).toBeInTheDocument();
    expect(api.retry).toBe(1);
    await waitFor(() => expect(api.health).toBeGreaterThan(1));
  });

  it("dismisses a report and reads the list again", async () => {
    const api = fakeApi({ session: TEST_USER, admin: true });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(api.resolved).toEqual(["4"]));
    await waitFor(() => expect(api.reports).toBeGreaterThan(1));
  });

  it("says one section could not be loaded and still shows the others", async () => {
    fakeApi({ session: TEST_USER, admin: true }, { health: () => HttpResponse.json({ error: "internal", message: "x" }, { status: 500 }) });
    await show();
    expect(await screen.findByTestId("report-row")).toBeInTheDocument();
    expect(await screen.findAllByText("Could not load this section.")).not.toHaveLength(0);
    expect(screen.queryByLabelText("System health")).toBeNull();
  });
});
