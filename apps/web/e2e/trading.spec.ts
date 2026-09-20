import type { Page } from "@playwright/test";
import { expect, FILLED, RPC_URL, test } from "./fixtures";
import { installWallet } from "./wallet";

// A 1x1 PNG: a real image, which the API decodes and re-encodes before it would be pinned.
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const ticker = () => `E${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 5).toUpperCase().padEnd(5, "X")}`;

test.setTimeout(150_000);

async function connect(page: Page) {
  await page.locator("header").getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "E2E Wallet" }).click();
  await expect(page.locator("header").getByRole("button", { name: "Disconnect" })).toBeVisible();
}

/** Fills the create form and sends it. The first click also signs the person in, in the wallet, as it would for real. */
async function createToken(page: Page, opts: { window: "No protection" | "60 seconds" | "10 minutes" | "98 minutes" }) {
  const symbol = ticker();
  await page.goto("/sepolia/create");
  await connect(page);
  await page.getByLabel(/^Name/).fill(`Token ${symbol}`);
  await page.getByLabel(/^Ticker/).fill(symbol);
  await page.getByLabel(/^Logo/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO });
  await page.getByRole("radio", { name: opts.window }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  // Lands on the new token's page, which says it is being set up until the indexer has seen it, then shows it.
  await expect(page).toHaveURL(/\/sepolia\/token\/0x[0-9a-f]{40}/, { timeout: 60_000 });
  await expect(page.getByTestId("trade-panel").getByRole("tab", { name: "Buy" })).toBeVisible({ timeout: 90_000 });
  return symbol;
}

const panel = (page: Page) => page.getByTestId("trade-panel");

test.describe("with a wallet", () => {
  test("create, buy, sell", async ({ page }) => {
    await installWallet(page, RPC_URL);
    const symbol = await createToken(page, { window: "No protection" });
    await expect(page.getByRole("heading", { name: `Token ${symbol}` })).toBeVisible();

    // Buy
    await panel(page).getByLabel("Amount to spend (ETH)").fill("0.001");
    await expect(panel(page).getByTestId("cost-breakdown")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled();
    await panel(page).getByRole("button", { name: "Buy" }).click();
    await expect(panel(page).getByText(new RegExp(`You bought .* ${symbol} for `))).toBeVisible({ timeout: 45_000 });

    // Sell it all back: approve first (this wallet cannot batch), then sell
    await panel(page).getByRole("tab", { name: "Sell" }).click();
    await expect(panel(page).getByRole("button", { name: "Max" })).toBeEnabled({ timeout: 30_000 });
    await panel(page).getByRole("button", { name: "Max" }).click();
    const sell = panel(page).getByRole("button", { name: "Step 1 of 2: approve selling" });
    await expect(sell).toBeEnabled();
    await sell.click();
    await expect(panel(page).getByText(new RegExp(`You sold .* ${symbol} and received `))).toBeVisible({ timeout: 60_000 });
  });

  test("declining to sign stops quietly, and trying again works", async ({ page }) => {
    const wallet = await installWallet(page, RPC_URL);
    await page.goto("/sepolia/create");
    await connect(page);
    const symbol = ticker();
    await page.getByLabel(/^Name/).fill(`Token ${symbol}`);
    await page.getByLabel(/^Ticker/).fill(symbol);
    await page.getByLabel(/^Logo/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO });

    wallet.rejectNext(); // the sign-in message
    await page.getByRole("button", { name: "Create token" }).click();
    await expect.poll(() => wallet.requests.filter((m) => m === "personal_sign").length).toBe(1);
    await expect(page.getByRole("button", { name: "Create token" })).toBeEnabled();
    // (Next itself keeps an empty alert region for route announcements, so look inside the form.)
    await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
    expect(wallet.requests).not.toContain("eth_sendTransaction");

    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page).toHaveURL(/\/sepolia\/token\/0x[0-9a-f]{40}/, { timeout: 60_000 });
  });

  test("the launch tax blocks a one-click buy and states the multiplier", async ({ page }) => {
    const wallet = await installWallet(page, RPC_URL);
    await createToken(page, { window: "98 minutes" });

    await panel(page).getByLabel("Amount to spend (ETH)").fill("0.001");
    await expect(panel(page).getByRole("status").first()).toContainText("Launch protection is on");
    await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled();
    const sentBefore = wallet.requests.filter((m) => m === "eth_sendTransaction").length;
    await panel(page).getByRole("button", { name: "Buy" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/\d+\.\d×/);
    await expect(dialog).toContainText(/9\d%/);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(wallet.requests.filter((m) => m === "eth_sendTransaction").length).toBe(sentBefore); // nothing was sent
  });

  test("the last buy reports what the chain says, and the confirmation outlives the panel", async ({ page }) => {
    await installWallet(page, RPC_URL);
    const symbol = await createToken(page, { window: "No protection" });

    // Far more than the 0.05 ETH the curve needs: the purchase is clipped to what is left.
    await panel(page).getByLabel("Amount to spend (ETH)").fill("0.2");
    await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled();
    await panel(page).getByRole("button", { name: "Buy" }).click();

    await expect(panel(page).getByText("GRADUATING…")).toBeVisible({ timeout: 60_000 });
    // 80% of a billion tokens is all that can be sold; not one more than the Trade event says.
    await expect(panel(page).getByText(new RegExp(`You bought 800M ${symbol} for 0\\.05`))).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Buy" })).toHaveCount(0);
  });
});

test("a graduated token replaces the trading panel with a Uniswap link", async ({ page }) => {
  await installWallet(page, RPC_URL);
  await page.goto(`/sepolia/token/${FILLED}`);
  const link = panel(page).getByRole("link", { name: "Trade on Uniswap" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", new RegExp(`outputCurrency=${FILLED}`));
  await expect(panel(page).getByRole("tab")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Buy" })).toHaveCount(0);
});
