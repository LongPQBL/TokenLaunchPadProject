import { expect, FILLED, LAUNCHPAD, SAME_BLOCK, setMetadata, sql, test } from "./fixtures";

test.afterAll(() => sql.end());

const card = (address: string) => `[data-testid="token-card"][href$="/token/${address}"]`;

test.describe("discover", () => {
  test("shows the testnet badge and both tokens the indexer found", async ({ page }) => {
    await page.goto("/sepolia");
    await expect(page.getByText("SEPOLIA TESTNET")).toBeVisible();
    await expect(page.locator(card(FILLED))).toBeVisible();
    await expect(page.locator(card(SAME_BLOCK))).toBeVisible();
    // The token that graduated says so on its card; the one still on its curve does not.
    await expect(page.locator(card(FILLED))).toContainText("GRADUATED");
    await expect(page.locator(card(SAME_BLOCK))).not.toContainText("GRADUAT");
  });

  test("shows a token whose metadata never resolved, with its on-chain name and a placeholder", async ({ page }) => {
    await page.goto("/sepolia");
    // Both fixture tokens name a metadata URI that is not real IPFS content, so the resolver marked them invalid.
    await expect(page.locator(card(FILLED))).toContainText("Demo Token");
    await expect(page.locator(card(FILLED)).getByTestId("token-image-placeholder")).toBeVisible();
  });

  test("searches by ticker, and puts the search in the URL", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByPlaceholder("Search tokens").fill("DEMO");
    await page.getByPlaceholder("Search tokens").press("Enter");
    await expect(page).toHaveURL(/[?&]q=DEMO/);
    await expect(page.getByTestId("token-card")).toHaveCount(1);
    await expect(page.locator(card(FILLED))).toBeVisible();
  });

  test("says so when a search matches nothing", async ({ page }) => {
    await page.goto("/sepolia?q=zzzzzzzz");
    await expect(page.getByText("No tokens match that search.")).toBeVisible();
  });

  test("switches the sort by link, and marks the active one", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByRole("link", { name: "Trending" }).click();
    await expect(page).toHaveURL(/sort=volume/);
    await expect(page.getByRole("link", { name: "Trending" })).toHaveAttribute("aria-current", "page");
    // The busiest token comes first.
    await expect(page.getByTestId("token-card").first()).toHaveAttribute("href", new RegExp(`${FILLED}$`));
  });

  // The header's main button must not lead anywhere broken, even before the create flow exists.
  test("the Create token button leads to a real page, not a 404", async ({ page }) => {
    await page.goto("/sepolia");
    await page.getByRole("link", { name: "Create token" }).click();
    await expect(page).toHaveURL(/\/sepolia\/create$/);
    await expect(page.getByText("Token creation is coming soon.")).toBeVisible();
  });

});

test.describe("a chain that is not configured", () => {
  test.use({ expectedNotFound: ["/nochain", "/nochain/create"] });

  test("is a 404, on the list and on every page beneath it", async ({ page }) => {
    expect((await page.goto("/nochain"))?.status()).toBe(404);
    expect((await page.goto("/nochain/create"))?.status()).toBe(404);
  });
});

test.describe("token page: a graduated token", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/sepolia/token/${FILLED}`);
  });

  test("shows the token, its status, its address and the way to trade it on Uniswap", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Demo Token" })).toBeVisible();
    await expect(page.getByTestId("status-badge")).toHaveText("GRADUATED");
    await expect(page.getByRole("link", { name: FILLED })).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${FILLED}`);
    const uniswap = page.getByRole("link", { name: "Trade on Uniswap" });
    await expect(uniswap).toHaveAttribute("href", new RegExp(`outputCurrency=${FILLED}`));
  });

  test("shows a full curve as collected against its target, not a wei short", async ({ page }) => {
    await expect(page.getByText("0.05 / 0.05 ETH collected")).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Graduation progress" })).toHaveAttribute("aria-valuenow", "100");
  });

  test("really draws the chart", async ({ page }) => {
    // Not merely "the container is there": the library must have put a canvas inside it.
    await expect(page.getByTestId("price-chart").locator("canvas").first()).toBeVisible();
  });

  test("lists the trades, then the holders, without the launchpad or the pool", async ({ page }) => {
    await expect(page.getByTestId("trade-row")).toHaveCount(3); // the flow's buy, sell and final buy
    await expect(page.getByTestId("trade-row").filter({ hasText: "Sell" })).toHaveCount(1);

    await page.getByRole("tab", { name: "Holders" }).click();
    const holders = page.getByTestId("holder-row");
    await expect(holders.first()).toBeVisible();
    const text = (await holders.allTextContents()).join(" ").toLowerCase();
    expect(text).not.toContain(LAUNCHPAD.slice(2, 8));
    expect(text).not.toContain("dead");
    // Every listed holder is a real one, so what is listed cannot exceed the whole supply.
    const shares = [...text.matchAll(/(\d+\.\d+)%/g)].map((m) => Number(m[1]));
    expect(shares.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
  });

  test("has a Comments tab that says comments are coming, without breaking the strip", async ({ page }) => {
    await page.getByRole("tab", { name: "Comments" }).click();
    await expect(page.getByText("Comments are coming soon.")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(3);
  });
});

test.describe("token page: a token still on its curve", () => {
  test("says TRADING, offers no Uniswap link, and lists its three same-block trades", async ({ page }) => {
    await page.goto(`/sepolia/token/${SAME_BLOCK}`);
    await expect(page.getByTestId("status-badge")).toHaveText("TRADING");
    await expect(page.getByRole("link", { name: "Trade on Uniswap" })).toHaveCount(0);
    await expect(page.getByTestId("trade-row")).toHaveCount(3);
    await expect(page.getByTestId("trade-row").filter({ hasText: "Buy" })).toHaveCount(3);
  });
});

test.describe("token page: what is not there", () => {
  test("says so for an address the indexer has not seen", async ({ page }) => {
    await page.goto("/sepolia/token/0x0000000000000000000000000000000000000001");
    await expect(page.getByText("Token not found.")).toBeVisible();
  });

  test("says so for something that is not an address, without asking the API", async ({ page }) => {
    await page.goto("/sepolia/token/not-an-address");
    await expect(page.getByText("Token not found.")).toBeVisible();
  });
});

test.describe("moderation and hostile metadata, through the real stack", () => {
  test("a token hidden in the database disappears from the list and from its own URL", async ({ page }) => {
    const undo = await setMetadata(SAME_BLOCK, { status: "hidden" });
    try {
      await page.goto("/sepolia");
      await expect(page.locator(card(FILLED))).toBeVisible();
      await expect(page.locator(card(SAME_BLOCK))).toHaveCount(0);

      await page.goto("/sepolia?q=SAME");
      await expect(page.getByText("No tokens match that search.")).toBeVisible();

      await page.goto(`/sepolia/token/${SAME_BLOCK}`);
      await expect(page.getByText("Token not found.")).toBeVisible();
    } finally {
      await undo();
    }
    await page.goto("/sepolia");
    await expect(page.locator(card(SAME_BLOCK))).toBeVisible(); // and it comes back when un-hidden
  });

  // A stranger controls these strings. In a real browser they must show up as text and run nothing.
  test("a hostile name, description and link are shown as text and execute nothing", async ({ page }) => {
    const undo = await setMetadata(SAME_BLOCK, {
      status: "ok",
      name: "<img src=x onerror=window.__pwned=1>",
      symbol: "PWN",
      description: "<script>window.__pwned=2</script>",
      socials: { website: "javascript:window.__pwned=3", twitter: "https://x.com/ok" },
    });
    try {
      await page.goto("/sepolia");
      await expect(page.getByText("<img src=x onerror=window.__pwned=1>")).toBeVisible();

      await page.goto(`/sepolia/token/${SAME_BLOCK}`);
      await expect(page.getByRole("heading", { name: "<img src=x onerror=window.__pwned=1>" })).toBeVisible();
      await expect(page.getByText("<script>window.__pwned=2</script>")).toBeVisible();
      // The link that is not http(s) is not a link at all; the one that is, is.
      await expect(page.getByRole("link", { name: "Website" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Twitter" })).toBeVisible();
      await expect(page.locator("a[href^='javascript:']")).toHaveCount(0);
      await expect(page.locator("img[onerror]")).toHaveCount(0);

      // Give any injected handler a chance to fire, then check none did.
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    } finally {
      await undo();
    }
  });
});
