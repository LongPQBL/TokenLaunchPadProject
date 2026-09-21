import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connect } from "wagmi/actions";
import { sepolia } from "wagmi/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { TradeError } from "@/lib/wallet/types";
import { fakeChain } from "@/test/fake-chain";
import { renderWithWallet, TEST_DEPLOYMENT, TEST_USER } from "@/test/wallet";
import { CreateForm } from "./create-form";

const WETH = "0x00000000000000000000000000000000000000e5";
const NEW_TOKEN = "0x00000000000000000000000000000000000000AB";

const trade = vi.hoisted(() => ({
  capabilities: { kind: "self-custody", address: undefined, chainId: undefined, canBatch: false, isZeroPrompt: false },
  buyWithEth: vi.fn(),
  sell: vi.fn(),
  approveIfNeeded: vi.fn(),
  createToken: vi.fn(),
}));
const siwe = vi.hoisted(() => ({ isSignedIn: true, isLoading: false, signIn: vi.fn(), signOut: vi.fn() }));
const upload = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("@/lib/wallet/use-trade", () => ({ useTrade: () => trade }));
vi.mock("@/lib/auth/use-siwe", () => ({ useSiwe: () => siwe }));
vi.mock("@/lib/create/upload", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/create/upload")>()), getUploader: () => upload }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT", TEST_DEPLOYMENT);
  for (const fn of [trade.createToken, siwe.signIn, upload, router.push]) fn.mockReset();
  siwe.isSignedIn = true;
  upload.mockResolvedValue("ipfs://bafyabcde");
  trade.createToken.mockResolvedValue({ token: NEW_TOKEN, hash: `0x${"ab".repeat(32)}` });
  siwe.signIn.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

const logo = () => new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

async function setup({ connected = true, chain = fakeChain() } = {}) {
  const view = renderWithWallet(<CreateForm chain="sepolia" />, undefined, chain.transport);
  if (connected) await act(() => connect(view.config, { connector: view.config.connectors[0]!, chainId: sepolia.id }));
  return { user: userEvent.setup(), ...view };
}

async function fill(user: ReturnType<typeof userEvent.setup>, o: { name?: string; ticker?: string; website?: string; file?: File | null } = {}) {
  await user.type(screen.getByLabelText(/^Name/), o.name ?? "Demo Token");
  await user.type(screen.getByLabelText(/^Ticker/), o.ticker ?? "demo");
  if (o.website) await user.type(screen.getByLabelText(/^Website/), o.website);
  if (o.file !== null) await user.upload(screen.getByLabelText(/^Logo/), o.file ?? logo());
}

const submit = () => screen.getByRole("button", { name: "Create token" });

describe("CreateForm: a wallet with no ETH", () => {
  it("says how to add ETH, with the address, before the button", async () => {
    await setup({ chain: fakeChain({ ethBalance: 0n }) });
    expect(await screen.findByText(/holds no ETH/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(TEST_USER, "i"))).toBeInTheDocument();
  });

  it("says nothing of funding to a wallet that has ETH", async () => {
    await setup();
    await screen.findByRole("button", { name: "Create token" });
    expect(screen.queryByText(/holds no ETH/i)).toBeNull();
  });
});

describe("CreateForm: the form", () => {
  it("offers the four launch-protection windows and defaults to 60 seconds", async () => {
    await setup();
    expect(screen.getByRole("radio", { name: "60 seconds" })).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
  });

  it("rejects a 33-character name, a 1-character ticker and a spaced ticker before any request is sent", async () => {
    const { user } = await setup();
    await fill(user, { name: "x".repeat(33), ticker: "A" });
    await user.click(submit());
    expect(screen.getByText("Enter a name of 1 to 32 characters.")).toBeInTheDocument();
    expect(screen.getByText("Use 2 to 10 letters or digits, with no spaces.")).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^Ticker/));
    await user.type(screen.getByLabelText(/^Ticker/), "AB CD");
    await user.click(submit());
    expect(screen.getByText("Use 2 to 10 letters or digits, with no spaces.")).toBeInTheDocument();

    expect(upload).not.toHaveBeenCalled();
    expect(siwe.signIn).not.toHaveBeenCalled();
    expect(trade.createToken).not.toHaveBeenCalled();
  });

  it("rejects a link that is not http(s), and a logo that is missing or the wrong kind", async () => {
    const { user } = await setup();
    await fill(user, { website: "javascript:alert(1)", file: null });
    await user.click(submit());
    expect(screen.getByText("Enter a link that starts with http:// or https://.")).toBeInTheDocument();
    expect(screen.getByText("Choose a logo.")).toBeInTheDocument();

    // A person can pick any file if the browser lets them: userEvent honours `accept` unless told not to.
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText(/^Logo/), new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
    await user.click(submit());
    expect(screen.getByText("Choose a PNG, JPEG or WebP image of 2 MB or less.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows the creation fee and the estimated network fee before the wallet opens", async () => {
    const { user } = await setup({ chain: fakeChain({ createFee: 5_000_000_000_000_000n }) });
    await fill(user, { file: null });
    const costs = screen.getByTestId("create-costs");
    await waitFor(() => expect(within(costs).getByText("0.005 ETH")).toBeInTheDocument());
    await waitFor(() => expect(within(costs).getByText(/0\.00015 ETH/)).toBeInTheDocument()); // 150,000 gas at 1 gwei
    expect(trade.createToken).not.toHaveBeenCalled();
  });

  it("asks to connect a wallet rather than offering a creation that cannot happen", async () => {
    await setup({ connected: false });
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create token" })).not.toBeInTheDocument();
  });
});

describe("CreateForm: creating", () => {
  it("uploads, then creates on chain with the returned URI and the chosen window, then opens the new token's page", async () => {
    const { user } = await setup();
    await fill(user, { website: "https://example.com" });
    await user.click(screen.getByRole("radio", { name: "10 minutes" }));
    await user.click(submit());

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/sepolia/token/${NEW_TOKEN.toLowerCase()}?new=1`));
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ name: "Demo Token", ticker: "demo", website: "https://example.com", antiSniperWindow: 600 }), expect.any(File));
    expect(trade.createToken).toHaveBeenCalledWith({ name: "Demo Token", ticker: "demo", metadataURI: "ipfs://bafyabcde", quoteToken: WETH, antiSniperWindow: 600 });
    expect(upload.mock.invocationCallOrder[0]).toBeLessThan(trade.createToken.mock.invocationCallOrder[0]!);
  });

  it("shows the three steps advancing: uploading, then the wallet, then live", async () => {
    let finishUpload!: (uri: string) => void;
    let finishCreate!: (r: unknown) => void;
    upload.mockReturnValue(new Promise((r) => (finishUpload = r)));
    trade.createToken.mockReturnValue(new Promise((r) => (finishCreate = r)));
    const { user } = await setup();
    await fill(user);
    const state = () => screen.getAllByRole("listitem").map((i) => i.dataset.state);

    expect(state()).toEqual(["waiting", "waiting", "waiting"]);
    await user.click(submit());
    await waitFor(() => expect(state()).toEqual(["current", "waiting", "waiting"]));
    await act(async () => finishUpload("ipfs://bafyabcde"));
    await waitFor(() => expect(state()).toEqual(["done", "current", "waiting"]));
    await act(async () => finishCreate({ token: NEW_TOKEN, hash: `0x${"ab".repeat(32)}` }));
    await waitFor(() => expect(state()).toEqual(["done", "done", "done"]));
  });

  it("signs in first when there is no session, and does nothing more if the person declines to sign", async () => {
    siwe.isSignedIn = false;
    siwe.signIn.mockResolvedValue(false);
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    await waitFor(() => expect(siwe.signIn).toHaveBeenCalledOnce());
    expect(upload).not.toHaveBeenCalled();
    expect(trade.createToken).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });

  it("goes on to upload once the person has signed in", async () => {
    siwe.isSignedIn = false;
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    await waitFor(() => expect(trade.createToken).toHaveBeenCalled());
    expect(siwe.signIn.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0]!);
  });

  it("sends NO transaction when pinning fails, and says why in the server's words", async () => {
    upload.mockRejectedValue(new ApiError(502, "pin_failed", "Could not store the image right now. Please try again."));
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not store the image right now. Please try again.");
    expect(trade.createToken).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled(); // and the form is intact, to try again
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Demo Token");
  });

  it("tells a person who has uploaded too much to come back later", async () => {
    upload.mockRejectedValue(new ApiError(429, "rate_limited", "You have uploaded a lot recently. Please try again later."));
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("try again later");
  });

  it("stays calm when the person declines the transaction in their wallet", async () => {
    trade.createToken.mockRejectedValue(new TradeError("user_rejected", "declined"));
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    await waitFor(() => expect(trade.createToken).toHaveBeenCalled());
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("explains a failed transaction in words, without leaving the form", async () => {
    trade.createToken.mockRejectedValue(new TradeError("wrong_chain", "raw"));
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent("Switch your wallet to the right network.");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("cannot be submitted twice while it is working", async () => {
    upload.mockReturnValue(new Promise(() => {}));
    const { user } = await setup();
    await fill(user);
    await user.click(submit());
    await waitFor(() => expect(submit()).toBeDisabled());
    await user.click(submit());
    expect(upload).toHaveBeenCalledOnce();
  });
});
