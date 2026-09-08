/**
 * EVOCK — AES-GCM encryption tests (Role B step 04, B4).
 */

import { describe, expect, it, vi } from "vitest";
import {
  decryptBlob,
  encryptBlob,
  getVaultKey,
  IV_LENGTH,
  VAULT_KEY_ID
} from "../../extension/src/crypto/encrypt.js";
import { openDb, requestToPromise, STORE_KEYS } from "../../extension/src/storage/db.js";
import { PNG_1x1_BYTES } from "../helpers/fixtures.js";

async function freshAesKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
}

const asBytes = (buffer) => Array.from(new Uint8Array(buffer));

describe("encryptBlob / decryptBlob — round trip", () => {
  it("returns bytes identical to the input", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(IV_LENGTH);
    expect(ciphertext).toBeInstanceOf(ArrayBuffer);

    const recovered = await decryptBlob(ciphertext, iv, key);
    expect(asBytes(recovered)).toEqual(Array.from(PNG_1x1_BYTES));
  });

  it("handles an empty buffer", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(new Uint8Array(0), key);

    expect(asBytes(await decryptBlob(ciphertext, iv, key))).toEqual([]);
  });

  it("handles a screenshot-sized buffer", async () => {
    const key = await getVaultKey();
    const big = crypto.getRandomValues(new Uint8Array(64 * 1024));
    const rest = new Uint8Array(700 * 1024);
    const plaintext = new Uint8Array(big.length + rest.length);
    plaintext.set(big);
    plaintext.set(rest, big.length);

    const { ciphertext, iv } = await encryptBlob(plaintext, key);
    expect(asBytes(await decryptBlob(ciphertext, iv, key))).toEqual(Array.from(plaintext));
  });

  it("accepts an ArrayBuffer as plaintext", async () => {
    const key = await getVaultKey();
    const buffer = PNG_1x1_BYTES.slice().buffer;
    const { ciphertext, iv } = await encryptBlob(buffer, key);

    expect(asBytes(await decryptBlob(ciphertext, iv, key))).toEqual(Array.from(PNG_1x1_BYTES));
  });

  it("decrypts with the IV after an IndexedDB-style round trip to ArrayBuffer", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    // storage/vault-repo stores iv as iv.buffer and reads it back as ArrayBuffer.
    const ivBuffer = iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength);
    expect(asBytes(await decryptBlob(ciphertext, ivBuffer, key))).toEqual(
      Array.from(PNG_1x1_BYTES)
    );
  });
});

describe("encryptBlob — IV uniqueness", () => {
  it("uses a different IV and produces different ciphertext for the same plaintext", async () => {
    const key = await getVaultKey();
    const a = await encryptBlob(PNG_1x1_BYTES, key);
    const b = await encryptBlob(PNG_1x1_BYTES, key);

    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
    expect(asBytes(a.ciphertext)).not.toEqual(asBytes(b.ciphertext));
  });

  it("draws a fresh 12-byte IV every call", async () => {
    const key = await getVaultKey();
    const seen = new Set();

    for (let i = 0; i < 25; i++) {
      const { iv } = await encryptBlob(PNG_1x1_BYTES, key);
      expect(iv.length).toBe(12);
      seen.add(Array.from(iv).join(","));
    }
    expect(seen.size).toBe(25);
  });

  it("gives the caller no way to pass an IV", () => {
    expect(encryptBlob.length).toBe(2); // (arrayBuffer, key) — no iv parameter
  });
});

describe("decryptBlob — fails closed", () => {
  it("rejects when the IV does not match", async () => {
    const key = await getVaultKey();
    const { ciphertext } = await encryptBlob(PNG_1x1_BYTES, key);
    const wrongIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    await expect(decryptBlob(ciphertext, wrongIv, key)).rejects.toThrow();
  });

  it("rejects when one ciphertext byte is flipped", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0x01;

    await expect(decryptBlob(tampered.buffer, iv, key)).rejects.toThrow();
  });

  it("rejects when the auth tag at the end is flipped", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0x80;

    await expect(decryptBlob(tampered.buffer, iv, key)).rejects.toThrow();
  });

  it("rejects a different key", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    await expect(decryptBlob(ciphertext, iv, await freshAesKey())).rejects.toThrow();
  });

  it("refuses a wrong-length IV up front", async () => {
    const key = await getVaultKey();
    const { ciphertext } = await encryptBlob(PNG_1x1_BYTES, key);

    await expect(decryptBlob(ciphertext, new Uint8Array(8), key)).rejects.toThrow(/12 bytes/);
    await expect(decryptBlob(ciphertext, new Uint8Array(16), key)).rejects.toThrow(/12 bytes/);
  });

  it("never returns wrong plaintext — every failure is a rejection", async () => {
    const key = await getVaultKey();
    const other = await freshAesKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    const attempts = [
      decryptBlob(ciphertext, crypto.getRandomValues(new Uint8Array(12)), key),
      decryptBlob(ciphertext, iv, other),
      decryptBlob(new Uint8Array(ciphertext.byteLength).buffer, iv, key)
    ];

    const results = await Promise.allSettled(attempts);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });
});

describe("getVaultKey", () => {
  it("is AES-GCM 256 and non-extractable", async () => {
    const key = await getVaultKey();

    expect(key.type).toBe("secret");
    expect(key.algorithm.name).toBe("AES-GCM");
    expect(key.algorithm.length).toBe(256);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("jwk", key)).rejects.toThrow();
  });

  it("returns the same key on repeated calls", async () => {
    expect(await getVaultKey()).toBe(await getVaultKey());
  });

  it("persists one key that still decrypts after a module reset", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    vi.resetModules();
    const reloaded = await import("../../extension/src/crypto/encrypt.js");
    const key2 = await reloaded.getVaultKey();

    expect(Array.from(new Uint8Array(await reloaded.decryptBlob(ciphertext, iv, key2)))).toEqual(
      Array.from(PNG_1x1_BYTES)
    );
  });

  it("stores exactly one vault record holding a CryptoKey", async () => {
    await getVaultKey();
    const db = await openDb();
    const record = await requestToPromise(
      db.transaction(STORE_KEYS, "readonly").objectStore(STORE_KEYS).get(VAULT_KEY_ID)
    );

    expect(record.id).toBe(VAULT_KEY_ID);
    expect(record.key).toBeInstanceOf(CryptoKey);
    expect(record.key.extractable).toBe(false);
  });

  it("does not generate a second key under concurrent callers", async () => {
    vi.resetModules();
    const reloaded = await import("../../extension/src/crypto/encrypt.js");

    const [k1, k2, k3] = await Promise.all([
      reloaded.getVaultKey(),
      reloaded.getVaultKey(),
      reloaded.getVaultKey()
    ]);

    // All three must interoperate: encrypt with one, decrypt with another.
    const { ciphertext, iv } = await reloaded.encryptBlob(PNG_1x1_BYTES, k1);
    expect(
      Array.from(new Uint8Array(await reloaded.decryptBlob(ciphertext, iv, k2)))
    ).toEqual(Array.from(PNG_1x1_BYTES));
    expect(k3).toBe(k1);
  });
});

describe("encrypt / decrypt — input validation", () => {
  it("rejects a non-buffer plaintext", async () => {
    const key = await getVaultKey();
    await expect(encryptBlob("a string", key)).rejects.toThrow(TypeError);
    await expect(encryptBlob(null, key)).rejects.toThrow(TypeError);
  });

  it("rejects a missing or non-CryptoKey key", async () => {
    await expect(encryptBlob(PNG_1x1_BYTES, null)).rejects.toThrow(/CryptoKey/);
    await expect(encryptBlob(PNG_1x1_BYTES, {})).rejects.toThrow(/CryptoKey/);
    await expect(decryptBlob(new Uint8Array(32).buffer, new Uint8Array(12), "nope")).rejects.toThrow(
      /CryptoKey/
    );
  });
});

describe("getVaultKey — damaged records and recovery", () => {
  it("reports a vault record that holds no key, and recovers once it is removed", async () => {
    // Mirrors the keystore's damaged-record handling: a bare ConstraintError
    // here would make every future decrypt fail with an opaque message.
    const { txDone } = await import("../../extension/src/storage/db.js");
    const db = await openDb();

    let tx = db.transaction(STORE_KEYS, "readwrite");
    tx.objectStore(STORE_KEYS).put({ id: VAULT_KEY_ID });
    await txDone(tx);

    vi.resetModules();
    let encrypt = await import("../../extension/src/crypto/encrypt.js");
    await expect(encrypt.getVaultKey()).rejects.toThrow(/vault key record/i);

    // The rejection must not be cached — a retry after cleanup has to succeed.
    tx = db.transaction(STORE_KEYS, "readwrite");
    tx.objectStore(STORE_KEYS).delete(VAULT_KEY_ID);
    await txDone(tx);

    const key = await encrypt.getVaultKey();
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("adopts a vault key already stored by another context", async () => {
    // A rival key persisted before this module loads: old records were encrypted
    // under it, so generating a new one would strand them.
    const { txDone } = await import("../../extension/src/storage/db.js");
    const db = await openDb();

    let tx = db.transaction(STORE_KEYS, "readwrite");
    tx.objectStore(STORE_KEYS).delete(VAULT_KEY_ID);
    await txDone(tx);

    const rival = await freshAesKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      rival,
      new Uint8Array([9, 8, 7])
    );

    tx = db.transaction(STORE_KEYS, "readwrite");
    tx.objectStore(STORE_KEYS).add({ id: VAULT_KEY_ID, key: rival });
    await txDone(tx);

    vi.resetModules();
    const encrypt = await import("../../extension/src/crypto/encrypt.js");
    const adopted = await encrypt.getVaultKey();

    expect(Array.from(new Uint8Array(await encrypt.decryptBlob(ciphertext, iv, adopted)))).toEqual([
      9, 8, 7
    ]);
  });
});

describe("encrypt / decrypt — typed-array view offsets", () => {
  it("encrypts only the bytes a subarray view spans", async () => {
    const key = await getVaultKey();
    const backing = new Uint8Array([0, 0, 0, 11, 22, 33, 44, 0, 0]);
    const view = backing.subarray(3, 7);

    const { ciphertext, iv } = await encryptBlob(view, key);
    const out = new Uint8Array(await decryptBlob(ciphertext, iv, key));

    expect(Array.from(out)).toEqual([11, 22, 33, 44]);
  });

  it("respects offsets on the ciphertext and iv views passed to decrypt", async () => {
    const key = await getVaultKey();
    const { ciphertext, iv } = await encryptBlob(PNG_1x1_BYTES, key);

    const ctPadded = new Uint8Array(ciphertext.byteLength + 5);
    ctPadded.set(new Uint8Array(ciphertext), 5);
    const ivPadded = new Uint8Array(iv.length + 4);
    ivPadded.set(iv, 4);

    const out = new Uint8Array(
      await decryptBlob(ctPadded.subarray(5), ivPadded.subarray(4), key)
    );
    expect(Array.from(out)).toEqual(Array.from(PNG_1x1_BYTES));
  });
});
