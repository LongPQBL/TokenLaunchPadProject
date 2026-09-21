import { expect, FILLED, RPC_URL, test } from "./fixtures";
import { connect, createToken, LOGO, panel, spendEth, ticker } from "./helpers";
import { installWallet } from "./wallet";

test.setTimeout(150_000);

test.describe("with a wallet", () => {
  test("create, buy, sell", async ({ page }) => {
    await installWallet(page, RPC_URL);
    const symbol = await createToken(page, { window: "No protection" });
    await expect(page.getByRole("heading", { name: `Token ${symbol}` })).toBeVisible();

    // Buy
    await spendEth(page, "0.001");
    await expect(panel(page).getByTestId("cost-breakdown")).toBeVisible();
    await expect(panel(page).getByRole("button", { name: "Buy" })).toBeEnabled();
    await panel(page).getByRole("button", { name: "Buy" }).click();
    await expect(panel(page).getByText(new RegExp(`You bought .* ${symbol} for `))).toBeVisible({ timeout: 45_000 });

    // Sell it all back: one press. The tokens need approving first, and the trading wallet signs both by itself.
    await panel(page).getByRole("tab", { name: "Sell" }).click();
    await expect(panel(page).getByRole("button", { name: "Max" })).toBeEnabled({ timeout: 30_000 });
    await panel(page).getByRole("button", { name: "Max" }).click();
    const sell = panel(page).getByRole("button", { name: "Sell", exact: true });
    await expect(sell).toBeEnabled();
    await sell.click();
    await expect(panel(page).getByText(new RegExp(`You sold .* ${symbol} and received `))).toBeVisible({ timeout: 60_000 });
  });

  test("buys with dollars: the box takes dollars, says what that is in ETH, and the buy goes through", async ({ page }) => {
    await installWallet(page, RPC_URL);
    const symbol = await createToken(page, { window: "No protection" });

    // The price of ETH comes from the chain's own feed a moment after the page loads: until then the box is in ETH.
    const dollars = panel(page).getByRole("textbox", { name: "Amount to spend (USD)" });
    await expect(dollars).toBeVisible({ timeout: 30_000 });
    await dollars.fill("1");
    await expect(panel(page).getByTestId("equivalent")).toHaveText(/^≈ 0\.000\d+ ETH$/);
    await expect(panel(page).getByTestId("cost-breakdown")).toContainText("You receive (est.)");
    await expect(panel(page).getByTestId("balance")).toContainText(/^Balance \$[\d,]+\.\d\d$/); // the wallet's balance, in dollars
    const buy = panel(page).getByRole("button", { name: "Buy" });
    await expect(buy).toBeEnabled();
    await buy.click();
    await expect(panel(page).getByText(new RegExp(`You bought .* ${symbol} for `))).toBeVisible({ timeout: 45_000 });
  });

  test("declining the one signature that opens the trading wallet stops quietly, and opening it afterwards works", async ({ page }) => {
    const wallet = await installWallet(page, RPC_URL);
    wallet.rejectNext(); // the message that opens the trading wallet, asked for as soon as the wallet connects
    await page.goto("/sepolia/create");
    await connect(page);
    const symbol = ticker();
    await page.getByLabel(/^Name/).fill(`Token ${symbol}`);
    await page.getByLabel(/^Ticker/).fill(symbol);
    await page.getByLabel(/^Logo/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: LOGO });

    // It said no: nothing can be created, it says how to open the trading wallet, and it does not ask again by itself.
    await expect(page.getByRole("button", { name: "Open trading wallet" }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Create token" })).toBeDisabled();
    // (Next itself keeps an empty alert region for route announcements, so look inside the form.)
    await expect(page.locator("form").getByRole("alert")).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(wallet.requests.filter((m) => m === "personal_sign").length).toBe(1);
    expect(wallet.requests).not.toContain("eth_sendTransaction");

    await page.getByRole("button", { name: "Open trading wallet" }).first().click();
    await expect(page.getByRole("button", { name: "Create token" })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page).toHaveURL(/\/sepolia\/token\/0x[0-9a-f]{40}/, { timeout: 60_000 });
  });

  test("the launch tax blocks a one-click buy and states the multiplier", async ({ page }) => {
    const wallet = await installWallet(page, RPC_URL);
    await createToken(page, { window: "98 minutes" });

    await spendEth(page, "0.001");
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
    await spendEth(page, "0.2");
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
