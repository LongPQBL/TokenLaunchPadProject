import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, deriveSessionAccount, loadOrCreateSession, SESSION_MESSAGE, SessionMismatchError } from "./derive";

const SIG_A = `0x${"ab".repeat(65)}` as const;
const SIG_B = `0x${"cd".repeat(65)}` as const;
const MAIN = "0x00000000000000000000000000000000000000a1";
const OTHER = "0x00000000000000000000000000000000000000b2";

/** Wipes everything a browser keeps: what "clear site data", a new browser or a new machine amounts to. */
function wipeBrowser() {
  localStorage.clear();
  sessionStorage.clear();
  globalThis.indexedDB = new IDBFactory();
}

beforeEach(wipeBrowser);

describe("deriveSessionAccount", () => {
  // These two addresses pin the derivation. If they ever change, every session wallet in the world changes with them and
  // whatever it held is stranded: this test is the one that must not be "fixed" by updating the numbers.
  it("keeps deriving the same wallet from the same signature, for ever", () => {
    expect(deriveSessionAccount(SIG_A).address).toBe("0xc680a94EC50481863188Fe80d5AA08911b39Cd52");
    expect(deriveSessionAccount(SIG_B).address).toBe("0xeD7f9B0918c7886702418b8776074819e5064B94");
  });

  it("gives a different wallet for a different signature", () => {
    expect(deriveSessionAccount(SIG_A).address).not.toBe(deriveSessionAccount(SIG_B).address);
  });

  it("throws rather than deriving from something that is not a 65-byte signature", () => {
    for (const bad of ["0x1234", "", `0x${"zz".repeat(65)}`, SIG_A.slice(2), `${SIG_A}00`]) {
      expect(() => deriveSessionAccount(bad as never), bad).toThrow();
    }
  });
});

describe("the session message", () => {
  it("is fixed, versioned and names no domain, so moving the site does not move the wallet", () => {
    expect(SESSION_MESSAGE).toBe("Vezta Launchpad — trading session v1");
    expect(SESSION_MESSAGE).not.toMatch(/https?:|localhost|\.com|\.app|\.io/);
  });
});

describe("loadOrCreateSession", () => {
  it("signs the exact fixed message and returns the wallet derived from it", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    const session = await loadOrCreateSession(MAIN, sign);
    expect(sign).toHaveBeenCalledWith(SESSION_MESSAGE);
    expect(session.address).toBe(deriveSessionAccount(SIG_A).address);
  });

  it("asks for a signature only once while the browser keeps its storage", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    const first = await loadOrCreateSession(MAIN, sign);
    const second = await loadOrCreateSession(MAIN, sign);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(second.address).toBe(first.address);
  });

  it("can sign with the recovered wallet: what comes back from storage is the same key, not just the same address", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    const first = await loadOrCreateSession(MAIN, sign);
    const again = await loadOrCreateSession(MAIN, sign);
    const message = "prove it";
    expect(await again.signMessage({ message })).toBe(await first.signMessage({ message }));
  });

  // The whole reason the key is derived rather than generated.
  it("recovers the SAME wallet after every bit of browser storage is wiped, by signing again", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A); // a deterministic wallet signs the same message the same way
    const before = await loadOrCreateSession(MAIN, sign);
    wipeBrowser();
    const after = await loadOrCreateSession(MAIN, sign);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(after.address).toBe(before.address);
  });

  it("keeps each main wallet's session separate", async () => {
    const a = await loadOrCreateSession(MAIN, vi.fn().mockResolvedValue(SIG_A));
    const b = await loadOrCreateSession(OTHER, vi.fn().mockResolvedValue(SIG_B));
    expect(a.address).not.toBe(b.address);
    const signAgain = vi.fn().mockResolvedValue(SIG_A);
    expect((await loadOrCreateSession(MAIN, signAgain)).address).toBe(a.address);
    expect(signAgain).not.toHaveBeenCalled();
  });

  it("treats the main address case-insensitively", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    await loadOrCreateSession(MAIN.toLowerCase(), sign);
    await loadOrCreateSession(MAIN.toUpperCase().replace("0X", "0x"), sign);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("signs once when asked twice at the same moment", async () => {
    const sign = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(() => r(SIG_A), 20)));
    const [a, b] = await Promise.all([loadOrCreateSession(MAIN, sign), loadOrCreateSession(MAIN, sign)]);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(a.address).toBe(b.address);
  });

  it("stores nothing, and passes the refusal on, when the person declines to sign", async () => {
    const sign = vi.fn().mockRejectedValue(new Error("User rejected the request."));
    await expect(loadOrCreateSession(MAIN, sign)).rejects.toThrow("User rejected");
    expect(localStorage.length).toBe(0);
  });

  it("signs again, instead of failing, when the stored copy has been damaged", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    await loadOrCreateSession(MAIN, sign);
    const key = Object.keys(localStorage).find((k) => k.endsWith(".key"))!;
    localStorage.setItem(key, "not-a-valid-ciphertext");
    const session = await loadOrCreateSession(MAIN, sign);
    expect(session.address).toBe(deriveSessionAccount(SIG_A).address);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  // The signature IS the key. Leaking it anywhere leaks the wallet.
  it("never writes the signature, or the private key, to storage in the clear", async () => {
    await loadOrCreateSession(MAIN, vi.fn().mockResolvedValue(SIG_A));
    const privateKey = "1090dbec48f7f57f241cd63982ccab202c65844d3a54ee797b1a6de433635179";
    const dump = JSON.stringify({ ...localStorage, ...sessionStorage });
    for (const secret of [SIG_A, SIG_A.slice(2, 40), privateKey, privateKey.slice(0, 32)]) expect(dump).not.toContain(secret);
    // ...nor with the case changed, nor base64-encoded
    expect(dump.toLowerCase()).not.toContain(privateKey);
    expect(dump).not.toContain(Buffer.from(privateKey, "hex").toString("base64"));
  });

  it("does not put the signature in a thrown error either", async () => {
    const sign = vi.fn().mockResolvedValue(`0x${"ab".repeat(64)}`); // one byte short
    const error = await loadOrCreateSession(MAIN, sign).catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain("abab");
  });
});

describe("what is kept", () => {
  it("wraps the key with an AES key that script can use but never read out (non-extractable)", async () => {
    await loadOrCreateSession(MAIN, vi.fn().mockResolvedValue(SIG_A));
    const wrapping = await new Promise<CryptoKey>((resolve, reject) => {
      const open = indexedDB.open("vezta-session", 1);
      open.onsuccess = () => {
        const get = open.result.transaction("keys").objectStore("keys").get(MAIN);
        get.onsuccess = () => resolve(get.result as CryptoKey);
        get.onerror = () => reject(get.error);
      };
    });
    expect(wrapping.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", wrapping)).rejects.toThrow();
  });

  it("does not trust a stored key whose address disagrees with the check value", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    await loadOrCreateSession(MAIN, sign);
    localStorage.setItem(`vezta.session.${MAIN}.address`, "0x00000000000000000000000000000000000000ff");
    // the stored key is not used; the wallet is asked again, and what it derives is measured against the check value
    await expect(loadOrCreateSession(MAIN, sign)).rejects.toBeInstanceOf(SessionMismatchError);
    expect(sign).toHaveBeenCalledTimes(2);
  });
});

describe("the check value", () => {
  it("refuses, loudly, when the wallet signs differently than it did: never a silent second wallet", async () => {
    await loadOrCreateSession(MAIN, vi.fn().mockResolvedValue(SIG_A));
    // The encrypted key is gone (say IndexedDB was cleared) but the address check value is still there...
    globalThis.indexedDB = new IDBFactory();
    // ...and this time the wallet signs the same message differently.
    await expect(loadOrCreateSession(MAIN, vi.fn().mockResolvedValue(SIG_B))).rejects.toBeInstanceOf(SessionMismatchError);
  });

  it("stores only the address as the check value: an address is not a secret", async () => {
    await loadOrCreateSession(MAIN, vi.fn().mockResolvedValue(SIG_A));
    const check = localStorage.getItem(`vezta.session.${MAIN}.address`);
    expect(check?.toLowerCase()).toBe("0xc680a94ec50481863188fe80d5aa08911b39cd52");
  });
});

describe("clearSession", () => {
  it("forgets the stored key, so the next load signs again, and keeps the check value", async () => {
    const sign = vi.fn().mockResolvedValue(SIG_A);
    await loadOrCreateSession(MAIN, sign);
    await clearSession(MAIN);
    await loadOrCreateSession(MAIN, sign);
    expect(sign).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(`vezta.session.${MAIN}.address`)).not.toBeNull();
  });
});
