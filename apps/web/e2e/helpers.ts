import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

// A 1x1 PNG: a real image, which the API decodes and re-encodes before it would be pinned.
export const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const ticker = () => `E${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 5).toUpperCase().padEnd(5, "X")}`;

/**
 * Connected, however it comes about. A wallet the site is already authorised in reconnects by itself when the page loads,
 * as MetaMask does, so a page that has been loaded before may be connected before anyone clicks.
 */
export async function ensureConnected(page: Page) {
  const disconnect = page.locator("header").getByRole("button", { name: "Disconnect" });
  // (isVisible ignores a timeout and answers at once, which is before a reconnecting page has finished reconnecting)
  if (await disconnect.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) return;
  await connect(page);
}

export async function connect(page: Page) {
  await page.locator("header").getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "E2E Wallet" }).click();
  await expect(page.locator("header").getByRole("button", { name: "Disconnect" })).toBeVisible();
}

/** Fills the create form and sends it. The first click also signs the person in, in the wallet, as it would for real. */
export async function createToken(page: Page, opts: { window: "No protection" | "60 seconds" | "10 minutes" | "98 minutes" }) {
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

export const panel = (page: Page) => page.getByTestId("trade-panel");

export const main = (page: Page) => page.locator("main");

/** A short tag that no other comment carries, so a test can find its own words on a page other tests have written on. */
export const tag = () => `t${Math.random().toString(36).slice(2, 8)}`;

/**
 * Opens the Comments tab and, if the form is asking for a session, signs in. (The wallet signs the sign-in message itself,
 * as a person would confirm it.) Ends with the comment box on screen.
 */
export async function openCommentsSignedIn(page: Page) {
  await page.getByRole("tab", { name: "Comments" }).click();
  const signIn = main(page).getByRole("button", { name: "Sign in" });
  if (
    await signIn.waitFor({ state: "visible", timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  )
    await signIn.click();
  await expect(main(page).getByRole("textbox", { name: "Comment" })).toBeVisible();
}

export async function postComment(page: Page, text: string) {
  await main(page).getByRole("textbox", { name: "Comment" }).fill(text);
  await main(page).getByRole("button", { name: "Post" }).click();
}

/** The comment bodies on the page whose text contains `needle`. */
export const commentsWith = (page: Page, needle: string) => page.getByTestId("comment-body").filter({ hasText: needle });

/**
 * Types an amount of ETH into the buy box. The box takes dollars while the chain's price feed answers (a second or so after the page
 * loads), so this waits for the switch to ETH and presses it; on a chain with no feed the box is in ETH already and it just types.
 */
export async function spendEth(page: Page, eth: string) {
  const inEth = panel(page).getByRole("button", { name: "Enter in ETH" });
  if (await inEth.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false)) await inEth.click();
  await panel(page).getByLabel("Amount to spend (ETH)").fill(eth);
}
