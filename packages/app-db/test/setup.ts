// The tests below call deleteMany. Pointing them at a development or real database would wipe it, so
// refuse to run at all unless the database is named as a test database.
const url = process.env.DATABASE_URL ?? "";
if (!/\/[^/?]*_test(\?|$)/.test(url)) {
  throw new Error(
    `Refusing to run: DATABASE_URL must point at a database whose name ends in _test (got "${url.replace(/\/\/[^@]*@/, "//***@")}").`,
  );
}
