import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl, DEFAULT_API_URL, wsUrl } from "./backend-url";

afterEach(() => vi.unstubAllEnvs());

// Where the backend is: written down once, so a default can be changed in one place and a blank value in a .env file cannot send every
// request to nowhere.
describe("apiUrl", () => {
  it("is the URL in NEXT_PUBLIC_API_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    expect(apiUrl()).toBe("https://api.example.com");
  });

  it("is the local backend's address when nothing is set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    expect(apiUrl()).toBe(DEFAULT_API_URL);
    expect(DEFAULT_API_URL).toBe("http://localhost:3001");
  });

  it("treats a blank value as not set: an empty line in a .env file is not an address", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "   ");
    expect(apiUrl()).toBe(DEFAULT_API_URL);
  });

  it("is read when it is asked for, not once at start-up", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://one.example.com");
    expect(apiUrl()).toBe("https://one.example.com");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://two.example.com");
    expect(apiUrl()).toBe("https://two.example.com");
  });
});

describe("wsUrl", () => {
  it("is NEXT_PUBLIC_WS_URL when it is set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "wss://live.example.com");
    expect(wsUrl()).toBe("wss://live.example.com");
  });

  it("is the API's address when there is none of its own: the same server speaks both", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.com");
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
    expect(wsUrl()).toBe("https://api.example.com");
  });

  it("falls back all the way to the local backend", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_WS_URL", "");
    expect(wsUrl()).toBe(DEFAULT_API_URL);
  });
});
