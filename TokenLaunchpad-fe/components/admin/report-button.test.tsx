import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { API } from "../../test/msw/handlers";
import { server } from "../../test/msw/server";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import { ReportButton } from "./report-button";

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

function fakeApi(opts: { session?: string; report?: { status: number; body: unknown } } = {}) {
  const state = { me: 0, reports: [] as unknown[] };
  server.use(
    http.get(`${API}/me`, () => {
      state.me += 1;
      return opts.session
        ? HttpResponse.json({ address: opts.session, admin: false })
        : HttpResponse.json({ error: "unauthenticated", message: "x" }, { status: 401 });
    }),
    http.post(`${API}/sepolia/tokens/:address/report`, async ({ request }) => {
      state.reports.push(await request.json());
      const r = opts.report ?? { status: 201, body: { id: "1" } };
      return HttpResponse.json(r.body as never, { status: r.status });
    }),
  );
  return state;
}
async function show(connected = true) {
  const wallet = renderWithWallet(<ReportButton chain="sepolia" token={TOKEN} />);
  if (connected) await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}
const file = async (text: string) => {
  await userEvent.click(await screen.findByRole("button", { name: "Report" }));
  await userEvent.type(await screen.findByRole("textbox", { name: "What is wrong?" }), text);
  await userEvent.click(screen.getByRole("button", { name: "Send report" }));
};

describe("ReportButton", () => {
  it("is there for anyone signed in, admin or not", async () => {
    fakeApi({ session: TEST_USER });
    await show();
    expect(await screen.findByRole("button", { name: "Report" })).toBeInTheDocument();
  });

  it("is absent for someone who is not signed in: there is no one to report as", async () => {
    const api = fakeApi({});
    const { container } = await show();
    await waitFor(() => expect(api.me).toBeGreaterThan(0));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(container.innerHTML).toBe("");
  });

  it("will not send an empty report", async () => {
    fakeApi({ session: TEST_USER });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Report" }));
    expect(await screen.findByRole("button", { name: "Send report" })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "What is wrong?" }), "   ");
    expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
  });

  it("sends the reason, and thanks the person", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show();
    await file("It is a scam");
    expect(await screen.findByText("Thank you. A moderator will look at it.")).toBeInTheDocument();
    expect(api.reports).toEqual([{ reason: "It is a scam" }]);
  });

  it("says so when the person had already reported it", async () => {
    fakeApi({ session: TEST_USER, report: { status: 200, body: { alreadyReported: true } } });
    await show();
    await file("again");
    expect(await screen.findByText("You have already reported this token. A moderator will look at it.")).toBeInTheDocument();
  });

  it("keeps the words and says why when the server refuses (too fast)", async () => {
    fakeApi({ session: TEST_USER, report: { status: 429, body: { error: "rate_limited", message: "x" } } });
    await show();
    await file("spam spam");
    expect(await screen.findByRole("alert")).toHaveTextContent("You are doing that too fast. Please try again later.");
    expect(screen.getByRole("textbox", { name: "What is wrong?" })).toHaveValue("spam spam");
  });

  it("limits the reason to 280 characters as the server does", async () => {
    fakeApi({ session: TEST_USER });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Report" }));
    const box = await screen.findByRole("textbox", { name: "What is wrong?" });
    expect(box).toHaveAttribute("maxlength", "280");
  });

  it("sends once however fast Send is clicked", async () => {
    const api = fakeApi({ session: TEST_USER });
    await show();
    await userEvent.click(await screen.findByRole("button", { name: "Report" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "What is wrong?" }), "once");
    const send = screen.getByRole("button", { name: "Send report" });
    // Both clicks land before React has drawn the first one's "busy" state: only the guard stands between them and two requests.
    act(() => {
      fireEvent.click(send);
      fireEvent.click(send);
    });
    await screen.findByText("Thank you. A moderator will look at it.");
    expect(api.reports).toHaveLength(1);
  });
});
