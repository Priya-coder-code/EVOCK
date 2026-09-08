/**
 * EVOCK — AES-GCM screenshot encryption (Role B, B4).
 *
 * The original screenshot is the evidence. This module keeps it confidential at
 * rest in the vault, and — because AES-GCM is authenticated encryption — makes
 * any modification of the stored `.enc` fail to decrypt rather than yield
 * plausible garbage that could be mistaken for the real artifact. A corrupted
 * ciphertext, a swapped IV, or the wrong key all fail closed.
 *
 * The screenshot is hashed BEFORE it reaches this module (see
 * `evidence/manifest-builder.js`): ciphertext changes on every re-encryption
 * because the IV is fresh each time, so the plaintext hash is the artifact's
 * stable identity and GCM's own auth tag covers ciphertext integrity separately.
 *
 * KEY ACQUISITION IS A SEAM
 * Everything goes through `getVaultKey()`. For the MVP that is a generated
 * non-extractable key persisted in IndexedDB. A future passphrase-locked vault
 * swaps the body of that one function for a PBKDF2 derivation; nothing else
 * changes.
 */

import { openDb, requestToPromise, STORE_KEYS, txDone } from "../storage/db.js";

/** Record id of the vault key in the `keys` store. */
export const VAULT_KEY_ID = "vault";

const AES_KEY_PARAMS = { name: "AES-GCM", length: 256 };

/** GCM's recommended IV size. 96 bits keeps the counter block unambiguous. */
export const IV_LENGTH = 12;

/** @type {Promise<CryptoKey>|null} */
let vaultKeyPromise = null;

/**
 * Load the vault's AES-GCM key, generating and persisting it on first use.
 *
 * Idempotent: repeated calls return the same key. The in-flight promise is
 * memoised so two concurrent callers in this context cannot each generate a key
 * and have the second overwrite the first — which would make every record
 * written before the overwrite undecryptable.
 *
 * @returns {Promise<CryptoKey>}
 */
export function getVaultKey() {
  if (!vaultKeyPromise) {
    vaultKeyPromise = loadOrCreateVaultKey().catch((error) => {
      vaultKeyPromise = null;
      throw error;
    });
  }
  return vaultKeyPromise;
}

/**
 * Encrypt bytes with the vault key under a fresh, internally generated IV.
 *
 * The IV is generated here, with `crypto.getRandomValues`, and never accepted
 * from the caller: IV reuse under GCM is a real cryptographic break, so there
 * must be no way for a caller to pass a constant.
 *
 * @param {ArrayBuffer|ArrayBufferView} arrayBuffer plaintext (the decoded screenshot)
 * @param {CryptoKey} key from `getVaultKey()`
 * @returns {Promise<{ ciphertext: ArrayBuffer, iv: Uint8Array }>}
 */
export async function encryptBlob(arrayBuffer, key) {
  if (!(arrayBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(arrayBuffer)) {
    throw new TypeError("encryptBlob: expected an ArrayBuffer or a typed-array view");
  }
  assertCryptoKey(key, "encryptBlob");

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, arrayBuffer);

  return { ciphertext, iv };
}

/**
 * Decrypt bytes produced by `encryptBlob`.
 *
 * Rejects — never returns wrong plaintext — if the ciphertext was modified, the
 * IV does not match, or the key is wrong: all three fail GCM's authentication
 * tag. A wrong-length IV is refused up front rather than handed to the platform.
 *
 * @param {ArrayBuffer|ArrayBufferView} ciphertext
 * @param {ArrayBuffer|ArrayBufferView} iv 12 bytes; a Uint8Array from
 *   `encryptBlob`, or the ArrayBuffer it becomes after an IndexedDB round trip
 * @param {CryptoKey} key from `getVaultKey()`
 * @returns {Promise<ArrayBuffer>} the original plaintext
 */
export async function decryptBlob(ciphertext, iv, key) {
  if (!(ciphertext instanceof ArrayBuffer) && !ArrayBuffer.isView(ciphertext)) {
    throw new TypeError("decryptBlob: expected an ArrayBuffer or a typed-array view for ciphertext");
  }
  assertCryptoKey(key, "decryptBlob");

  const ivBytes = toBytes(iv, "decryptBlob: iv");
  if (ivBytes.byteLength !== IV_LENGTH) {
    throw new TypeError(`decryptBlob: iv must be exactly ${IV_LENGTH} bytes`);
  }

  return crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, ciphertext);
}

/**
 * @returns {Promise<CryptoKey>}
 */
async function loadOrCreateVaultKey() {
  const existing = await readVaultKey();
  if (existing) return existing;

  // FUTURE: PBKDF2 derivation path plugs in here. Derive the key from the user's
  // passphrase with PBKDF2-SHA-256 (high iteration count, random per-vault salt
  // stored alongside this record), and skip the generate-and-persist below.
  const key = await crypto.subtle.generateKey(AES_KEY_PARAMS, false, ["encrypt", "decrypt"]);

  const db = await openDb();
  const tx = db.transaction(STORE_KEYS, "readwrite");
  // `add`, not `put`: if another context generated and stored a vault key while
  // this one was generating, the write fails with ConstraintError rather than
  // silently replacing a key that records were already encrypted with.
  const request = tx.objectStore(STORE_KEYS).add({ id: VAULT_KEY_ID, key });

  try {
    await requestToPromise(request);
    await txDone(tx);
    return key;
  } catch (error) {
    if (error?.name !== "ConstraintError") throw error;

    // Someone else won the race; adopt their key and discard ours.
    const stored = await readVaultKey();
    if (stored) return stored;

    // The record exists — that is why `add` failed — but holds no usable key.
    // Every screenshot in the vault is encrypted under a key that is now gone,
    // so this is unrecoverable: say so plainly rather than failing every future
    // decrypt with an opaque error.
    throw new Error(
      `encrypt: the stored vault key record ("${VAULT_KEY_ID}") is present but incomplete. ` +
        "Screenshots encrypted under the original key can no longer be decrypted."
    );
  }
}

/**
 * @returns {Promise<CryptoKey|null>}
 */
async function readVaultKey() {
  const db = await openDb();
  const record = await requestToPromise(
    db.transaction(STORE_KEYS, "readonly").objectStore(STORE_KEYS).get(VAULT_KEY_ID)
  );

  if (!record?.key) return null;
  return record.key;
}

/**
 * `CryptoKey` is a global in every context this runs in — MV3 service worker,
 * extension pages, and the Node test environment — so a strict check is safe.
 * A leniently duck-typed one only lets a malformed key reach `crypto.subtle`
 * and fail there with a vaguer message.
 *
 * @param {unknown} key
 * @param {string} where caller name, for the message
 */
function assertCryptoKey(key, where) {
  if (!(key instanceof CryptoKey)) {
    throw new TypeError(`${where}: expected a CryptoKey from getVaultKey()`);
  }
}

/**
 * @param {ArrayBuffer|ArrayBufferView} value
 * @param {string} where
 * @returns {Uint8Array}
 */
function toBytes(value, where) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${where}: expected an ArrayBuffer or a typed-array view`);
}
