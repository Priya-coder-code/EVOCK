/**
 * EVOCK — ECDSA signing keystore (Role B, B3).
 *
 * One P-256 keypair per vault, generated on first use and kept for the vault's
 * lifetime.
 *
 * THE PRIVATE KEY IS NON-EXTRACTABLE
 * `generateKey` is called with `extractable: false`, which applies to the
 * private key; per the Web Crypto specification the public key of an asymmetric
 * pair is always extractable, which is what lets us export it as JWK. The
 * private key can therefore be used to sign but never read out — not by our own
 * code, not by a log line, not by an exfiltration bug, and not into an export.
 *
 * IT IS PERSISTED AS A CryptoKey OBJECT
 * Structured clone supports `CryptoKey`, so IndexedDB can store and reload a
 * non-extractable key without its material ever becoming readable bytes. That
 * is the reason the keystore lives in IndexedDB rather than `chrome.storage`,
 * which would require serialising the key to something we can read.
 *
 * THE PUBLIC KEY GOES INTO EVERY MANIFEST
 * An exported evidence package must be verifiable on a machine that has never
 * seen this vault, so verification reads the key from the manifest rather than
 * from here (see `crypto/sign.js`). It also means a lost vault does not make
 * past evidence unverifiable.
 */

import { openDb, requestToPromise, STORE_KEYS, txDone } from "../storage/db.js";

/** Record id of the signing keypair in the `keys` store. */
export const SIGNING_KEY_ID = "signing";

const ECDSA_KEY_PARAMS = { name: "ECDSA", namedCurve: "P-256" };

/** @type {Promise<CryptoKeyPair>|null} */
let signingKeyPairPromise = null;

/**
 * Load the vault's signing keypair, generating and persisting it on first use.
 *
 * Idempotent: repeated calls return the same keypair. The in-flight promise is
 * memoised so two concurrent callers in this context cannot each generate a
 * pair and have the second overwrite the first.
 *
 * @returns {Promise<CryptoKeyPair>} { publicKey, privateKey }
 */
export function getSigningKeyPair() {
  if (!signingKeyPairPromise) {
    signingKeyPairPromise = loadOrCreateSigningKeyPair().catch((error) => {
      signingKeyPairPromise = null;
      throw error;
    });
  }
  return signingKeyPairPromise;
}

/**
 * The public half of the signing keypair, as a JWK ready to embed in a manifest.
 *
 * @returns {Promise<JsonWebKey>}
 */
export async function getSigningPublicKeyJwk() {
  const { publicKey } = await getSigningKeyPair();
  return crypto.subtle.exportKey("jwk", publicKey);
}

/**
 * @returns {Promise<CryptoKeyPair>}
 */
async function loadOrCreateSigningKeyPair() {
  const existing = await readSigningKeyPair();
  if (existing) return existing;

  const pair = await crypto.subtle.generateKey(ECDSA_KEY_PARAMS, false, ["sign", "verify"]);

  const db = await openDb();
  const tx = db.transaction(STORE_KEYS, "readwrite");
  // `add` rather than `put`: if another context (the popup, say) generated and
  // stored a keypair while this one was generating, the write fails with a
  // ConstraintError instead of silently replacing a key that records have
  // already been signed with.
  const request = tx.objectStore(STORE_KEYS).add({
    id: SIGNING_KEY_ID,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey
  });

  try {
    await requestToPromise(request);
    await txDone(tx);
    return pair;
  } catch (error) {
    if (error?.name !== "ConstraintError") throw error;

    // Someone else won the race; adopt their keypair and discard ours.
    const stored = await readSigningKeyPair();
    if (stored) return stored;

    // The record exists — that is why `add` failed — but it does not hold a
    // usable keypair. Every future preservation would fail here with a bare
    // ConstraintError that says nothing about the cause, so name it. Recovery
    // means deleting the record and letting a fresh keypair be generated; past
    // evidence still verifies, because each manifest carries its own public key.
    throw new Error(
      `keystore: the stored signing key record ("${SIGNING_KEY_ID}") is present but incomplete, ` +
        "so this vault cannot sign. Delete it to generate a new keypair; existing evidence " +
        "remains verifiable through the public key embedded in each manifest."
    );
  }
}

/**
 * @returns {Promise<CryptoKeyPair|null>}
 */
async function readSigningKeyPair() {
  const db = await openDb();
  const record = await requestToPromise(
    db.transaction(STORE_KEYS, "readonly").objectStore(STORE_KEYS).get(SIGNING_KEY_ID)
  );

  if (!record?.publicKey || !record?.privateKey) return null;
  return { publicKey: record.publicKey, privateKey: record.privateKey };
}
