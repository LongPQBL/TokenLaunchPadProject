import type { Page } from "@playwright/test";
import { expect, RPC_URL, SAME_BLOCK, test } from "./fixtures";
import { installWallet } from "./wallet";

// Privy is optional: these run only when the stack was started with E2E_PRIVY_APP_ID, which puts it in the web build.
test.skip(!process.env.E2E_PRIVY_APP_ID, "Privy is not part of this build (start scripts/e2e.sh with E2E_PRIVY_APP_ID)");
test.setTimeout(120_000);

const header = (page: Page) => page.locator("header");
const API = process.env.E2E_API_URL ?? "http://localhost:3101";

/** Logs in through Privy's screen with the e2e wallet (an external wallet, standing in for MetaMask). */
async function loginWithWallet(page: Page) {
  await header(page).getByRole("button", { name: "Log in" }).click();
  await page.getByText("Continue with a wallet").click();
  await page.getByText("E2E Wallet").first().click();
  await expect(header(page).getByRole("button", { name: "Log out" })).toBeVisible({ timeout: 60_000 });
}

const signatures = (requests: string[]) => requests.filter((m) => m === "personal_sign").length;
const apiSession = (page: Page) => page.evaluate(async (api) => (await fetch(`${api}/me`, { credentials: "include" })).status, API);

test("the header offers Log in, and Privy's screen offers email, Google and wallets", async ({ page }) => {
  await page.goto("/sepolia");
  await expect(header(page).getByRole("button", { name: "Log in" })).toBeEnabled({ timeout: 30_000 });
  await expect(header(page).getByRole("button", { name: "Connect wallet" })).toHaveCount(0);
  await header(page).getByRole("button", { name: "Log in" }).click();
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
  await expect(page.getByText("Google")).toBeVisible();
  await expect(page.getByText("Continue with a wallet")).toBeVisible();
});

// Review Focus 2: an external wallet that logged in THROUGH Privy is still an external wallet, with the Group C trading wallet.
test("an external wallet logs in through Privy for one signature, and is still offered the trading wallet", async ({ page }) => {
  const wallet = await installWallet(page, RPC_URL);
  await page.goto(`/sepolia/token/${SAME_BLOCK}`);
  await expect(header(page).getByRole("button", { name: "Log in" })).toBeEnabled({ timeout: 30_000 });
  await loginWithWallet(page);
  // Privy's own verification of the wallet is the only signature a login costs.
  expect(signatures(wallet.requests)).toBe(1);
  await expect(header(page).getByText(new RegExp(`^${wallet.address.slice(0, 6)}`, "i"))).toBeVisible();
  await expect(page.getByRole("button", { name: /turn on trading wallet/i })).toBeVisible();
  await expect(page.getByText("Your wallet")).toHaveCount(0);
  await expect(header(page).getByRole("button", { name: "Export key" })).toHaveCount(0); // no key of ours to hand over
});

// Review Focus 4: logging out ends both sessions.
test("logging out ends our API session as well as Privy's", async ({ page }) => {
  await installWallet(page, RPC_URL);
  await page.goto(`/sepolia/token/${SAME_BLOCK}`);
  await expect(header(page).getByRole("button", { name: "Log in" })).toBeEnabled({ timeout: 30_000 });
  await loginWithWallet(page);
  await page.getByRole("tab", { name: "Comments" }).click();
  await page.locator("main").getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("main").getByRole("textbox", { name: "Comment" })).toBeVisible();
  expect(await apiSession(page)).toBe(200);

  await header(page).getByRole("button", { name: "Log out" }).click();
  await expect(header(page).getByRole("button", { name: "Log in" })).toBeVisible({ timeout: 30_000 });
  expect(await apiSession(page)).toBe(401);
});

// Review Focus 1: Privy unreachable must not take every way of getting in with it.
test("with Privy blocked, the page still loads and the browser's wallet can still be connected after a few seconds", async ({ page }) => {
  await page.route(/privy\.(io|systems)/, (route) => route.abort());
  const wallet = await installWallet(page, RPC_URL);
  await page.goto("/sepolia");
  await expect(header(page).getByRole("button", { name: "Connect wallet" })).toBeVisible({ timeout: 30_000 });
  await header(page).getByRole("button", { name: "Connect wallet" }).click();
  // Privy's own wagmi config lists no wallets, so the way out brings the browser's own (window.ethereum).
  await page.getByRole("dialog").getByRole("button", { name: "Browser wallet" }).click();
  await expect(header(page).getByText(new RegExp(`^${wallet.address.slice(0, 6)}`, "i"))).toBeVisible({ timeout: 30_000 });
  await expect(header(page).getByRole("button", { name: "Disconnect" })).toBeVisible();
});
