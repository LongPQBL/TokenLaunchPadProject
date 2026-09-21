import type { Hex } from "viem";

/**
 * Where a session key waits between page loads, without ever being written down in the clear.
 *
 * The private key is encrypted with AES-GCM and the ciphertext is kept in localStorage. The AES key is created
 * NON-EXTRACTABLE and lives in IndexedDB, where script can use it but never read it out. Someone who copies localStorage
 * (a backup, a synced profile, a screenshot of devtools) gets ciphertext they cannot open. This does not defend against
 * script running in the page: nothing can, and that is what the content security policy is for. Losing this storage
 * costs nothing but one signature, because the key is derived and can be derived again.
 */

const DB_NAME = "vezta-session";
const STORE = "keys";

const id = (mainAddress: string) => mainAddress.toLowerCase();
const keyName = (main: string) => `vezta.session.${id(main)}.key`;
export const checkName = (main: string) => `vezta.session.${id(main)}.address`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const hexToBytes = (hex: Hex) => Uint8Array.from(hex.slice(2).match(/../g)!.map((b) => parseInt(b, 16)));
const bytesToHex = (bytes: Uint8Array): Hex => `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Encrypts and keeps a session key. Replaces whatever was kept for this main wallet. */
export async function saveKey(mainAddress: string, privateKey: Hex): Promise<void> {
  const wrapping = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapping, hexToBytes(privateKey)));
  await idb("readwrite", (s) => s.put(wrapping, id(mainAddress)));
  localStorage.setItem(keyName(mainAddress), b64(new Uint8Array([...iv, ...ciphertext])));
}

/** The kept session key, or undefined when there is none or it cannot be opened (cleared storage, damage, tampering). */
export async function loadKey(mainAddress: string): Promise<Hex | undefined> {
  try {
    const stored = localStorage.getItem(keyName(mainAddress));
    if (!stored) return undefined;
    const wrapping = (await idb("readonly", (s) => s.get(id(mainAddress)))) as CryptoKey | undefined;
    if (!wrapping) return undefined;
    const bytes = unb64(stored);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, wrapping, bytes.slice(12));
    return bytesToHex(new Uint8Array(plain));
  } catch {
    return undefined;
  }
}

export async function clearKey(mainAddress: string): Promise<void> {
  localStorage.removeItem(keyName(mainAddress));
  try {
    await idb("readwrite", (s) => s.delete(id(mainAddress)));
  } catch {
    /* nothing to delete */
  }
}
