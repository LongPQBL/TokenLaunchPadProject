import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = { DATABASE_URL: "postgresql://u@localhost:5432/db" };

describe("loadConfig", () => {
  it("parses a comma-separated CORS list, trimming and dropping blanks", () => {
    const c = loadConfig({ ...base, CORS_ORIGINS: " https://a.example , ,https://b.example," });
    expect(c.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
  });

  it("defaults to no allowed origins and port 3001", () => {
    const c = loadConfig(base);
    expect(c.corsOrigins).toEqual([]);
    expect(c.port).toBe(3001);
  });

  // Spec §5: cookies are in play, so a wildcard origin is refused outright rather than honoured.
  it("refuses a wildcard origin", () => {
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "*" })).toThrow(/wildcard|\*/i);
    expect(() => loadConfig({ ...base, CORS_ORIGINS: "https://a.example,*" })).toThrow();
  });

  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadConfig({ ...base, PORT: "abc" })).toThrow(/PORT/);
  });
});
