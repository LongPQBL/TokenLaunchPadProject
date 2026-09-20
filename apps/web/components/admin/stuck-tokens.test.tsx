import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "../../test/wallet";
import type { Health } from "@/lib/types";
import { StuckTokens } from "./stuck-tokens";

const migrate = vi.hoisted(() => ({ migrateToken: vi.fn() }));
vi.mock("@/lib/admin/migrate", () => migrate);

const A = "0x00000000000000000000000000000000000000b2";
const B = "0x00000000000000000000000000000000000000b3";
const NOW = 1_700_000_500;
const stuck = (o: Partial<Health["stuckTokens"][number]> = {}): Health["stuckTokens"][number] => ({
  address: A,
  name: "Full Coin",
  ticker: "FULL",
  completeSince: 1_700_000_000n,
  ...o,
});

beforeEach(() => {
  localStorage.clear();
  migrate.migrateToken.mockReset().mockResolvedValue({ hash: `0x${"ab".repeat(32)}` });
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
});

async function show(tokens: Health["stuckTokens"]) {
  const wallet = renderWithWallet(<StuckTokens chain="sepolia" tokens={tokens} now={NOW} />);
  await act(() => connect(wallet.config, { connector: wallet.config.connectors[0]!, chainId: sepolia.id }));
  return wallet;
}

describe("StuckTokens", () => {
  it("says nothing is waiting, rather than showing an empty list", async () => {
    await show([]);
    expect(screen.getByText("Nothing is waiting.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Migrate" })).toBeNull();
  });

  it("lists each curve with its name, ticker, how long it has been full and a link to its page", async () => {
    await show([stuck()]);
    const row = screen.getByTestId("stuck-token");
    expect(row).toHaveTextContent("Full Coin");
    expect(row).toHaveTextContent("FULL");
    expect(row).toHaveTextContent("full 8m ago");
    expect(screen.getByRole("link", { name: /0x0000…00b2/ })).toHaveAttribute("href", `/sepolia/token/${A}`);
  });

  it("draws a name that is markup as text", async () => {
    await show([stuck({ name: "<img src=x onerror=alert(1)>" })]);
    expect(screen.getByTestId("stuck-token")).toHaveTextContent("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });

  it("removes direction controls from a name and a ticker, so they cannot reorder what is drawn around them", async () => {
    const rlo = String.fromCharCode(0x202e);
    await show([stuck({ name: `${rlo}nimda`, ticker: `${rlo}KT` })]);
    expect(screen.getByTestId("stuck-token").textContent).not.toContain(rlo);
  });

  it("finishes the curve from the admin's own wallet on the deployment's launchpad, on the click", async () => {
    await show([stuck(), stuck({ address: B })]);
    expect(migrate.migrateToken).not.toHaveBeenCalled();
    await userEvent.click(screen.getAllByRole("button", { name: "Migrate" })[1]!);
    await waitFor(() => expect(migrate.migrateToken).toHaveBeenCalledTimes(1));
    const [deps, token] = migrate.migrateToken.mock.calls[0]!;
    expect(token).toBe(B);
    expect(deps).toMatchObject({ launchpad: "0x00000000000000000000000000000000000000c3", expectedChainId: 11155111, chainId: 11155111 });
    expect((deps as { account: string }).account.toLowerCase()).toBe(TEST_USER); // wagmi gives the checksummed form
    expect(await screen.findByText("Migrated.")).toBeInTheDocument();
  });

  it("says nothing when the person declines in their wallet: it is their choice, not an error", async () => {
    migrate.migrateToken.mockRejectedValue(Object.assign(new Error("denied"), { code: 4001 }));
    await show([stuck()]);
    await userEvent.click(screen.getByRole("button", { name: "Migrate" }));
    await waitFor(() => expect(migrate.migrateToken).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Migrate" })).toBeEnabled();
  });

  it("says why, in a sentence, when it fails, and never shows the raw error", async () => {
    migrate.migrateToken.mockRejectedValue(new Error("execution reverted: secret internals /home/x"));
    await show([stuck()]);
    await userEvent.click(screen.getByRole("button", { name: "Migrate" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/secret|home/);
  });

  it("sends once however fast it is clicked", async () => {
    let release!: () => void;
    migrate.migrateToken.mockReturnValue(new Promise((resolve) => (release = () => resolve({ hash: "0x1" }))));
    await show([stuck()]);
    const button = screen.getByRole("button", { name: "Migrate" });
    const { fireEvent } = await import("@testing-library/react");
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(migrate.migrateToken).toHaveBeenCalled());
    expect(migrate.migrateToken).toHaveBeenCalledTimes(1);
    release();
  });
});
