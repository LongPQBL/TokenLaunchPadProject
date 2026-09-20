import type { Page } from "@playwright/test";
import { expect, RPC_URL, test } from "./fixtures";
import { commentsWith, createToken, ensureConnected, main, openCommentsSignedIn, postComment, tag } from "./helpers";
import { installWallet } from "./wallet";

// Made once, on the page a person would actually make one from: a token of our own to write on, so no other test's words are in the way.
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let tokenUrl = "";
let author: Awaited<ReturnType<typeof installWallet>>;
let authorPage: Page;

test.beforeAll(async ({ browser }) => {
  authorPage = await (await browser.newContext()).newPage();
  author = await installWallet(authorPage, RPC_URL);
  await createToken(authorPage, { window: "No protection" });
  tokenUrl = authorPage.url().split("?")[0]!;
});

test.afterAll(async () => {
  await authorPage.context().close();
});

/** Someone else, with no wallet at all, looking at the same token. */
async function visitor(browser: import("@playwright/test").Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(tokenUrl);
  await page.getByRole("tab", { name: "Comments" }).click();
  return page;
}

test("sign in, comment, and see it appear in another browser without a reload", async ({ browser }) => {
  const other = await visitor(browser);
  await expect(other.getByText("No comments yet. Be the first to say something.")).toBeVisible();
  // Not connected, so the box says what to do rather than offering a form.
  await expect(main(other).getByText("Connect a wallet to join the conversation.")).toBeVisible();

  await ensureConnected(authorPage);
  await openCommentsSignedIn(authorPage);
  const words = `hello ${tag()}`;
  await postComment(authorPage, words);
  await expect(commentsWith(authorPage, words)).toHaveCount(1);
  await expect(main(authorPage).getByRole("textbox", { name: "Comment" })).toHaveValue("");

  // The other browser never reloaded: the socket brought it.
  await expect(commentsWith(other, words)).toHaveCount(1, { timeout: 20_000 });
  await other.context().close();
});

test("the author's own comment is listed once, however it arrives", async () => {
  const words = `once ${tag()}`;
  await postComment(authorPage, words);
  await expect(commentsWith(authorPage, words)).toHaveCount(1);
  // Give the socket's copy time to arrive: it must not add a second.
  await authorPage.waitForTimeout(2_500);
  await expect(commentsWith(authorPage, words)).toHaveCount(1);
});

// Review Focus 3: markup, a very long word and direction controls must render safely and must not break the layout.
test("a comment containing markup renders as text, and runs nothing", async ({ browser }) => {
  const other = await visitor(browser);
  const marker = tag();
  const markup = `<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script> ${marker}`;
  await postComment(authorPage, markup);

  for (const page of [authorPage, other]) {
    await expect(commentsWith(page, marker)).toHaveCount(1, { timeout: 20_000 });
    await expect(commentsWith(page, marker)).toContainText('<img src=x onerror="window.__pwned=1">');
    expect(await commentsWith(page, marker).locator("img, script").count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  }
  await other.context().close();
});

test("a very long word with no spaces does not widen the page", async ({ browser }) => {
  const other = await visitor(browser);
  const marker = tag();
  await postComment(authorPage, `${marker}${"W".repeat(480)}`);
  for (const page of [authorPage, other]) {
    await expect(commentsWith(page, marker)).toHaveCount(1, { timeout: 20_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  await other.context().close();
});

test("right-to-left override characters are removed, so they cannot reverse what follows", async () => {
  const marker = tag();
  const rlo = String.fromCharCode(0x202e);
  await postComment(authorPage, `${rlo}${marker}`);
  const body = commentsWith(authorPage, marker);
  await expect(body).toHaveCount(1);
  expect(await body.evaluate((el, c) => (el.textContent ?? "").includes(c), rlo)).toBe(false);
});

test("a username set on the profile appears beside their comments, and the address links to the profile", async () => {
  const name = `e2e_${tag()}`;
  const marker = tag();
  await postComment(authorPage, `named ${marker}`);
  await expect(commentsWith(authorPage, marker)).toHaveCount(1);

  await authorPage.goto(`/sepolia/profile/${author.address}`);
  await ensureConnected(authorPage);
  await authorPage.getByRole("button", { name: "Edit profile" }).click();
  await authorPage.getByRole("textbox", { name: "Username" }).fill(name);
  await authorPage.getByRole("button", { name: "Save" }).click();
  await expect(authorPage.getByRole("heading", { name })).toBeVisible();

  await authorPage.goto(tokenUrl);
  await authorPage.getByRole("tab", { name: "Comments" }).click();
  const item = authorPage.getByTestId("comment-item").filter({ hasText: marker });
  await expect(item.getByTestId("comment-author")).toHaveText(name);
  await expect(item.getByRole("link", { name })).toHaveAttribute("href", `/sepolia/profile/${author.address.toLowerCase()}`);
});
