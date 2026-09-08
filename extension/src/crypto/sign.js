/**
 * EVOCK — ECDSA P-256 manifest signing (Role B, B3).
 *
 * WHAT IS SIGNED
 * The signature covers the **bytes of the manifest hash**, not the whole
 * manifest. Signing a fixed 32-byte input keeps the operation cheap and the
 * input unambiguous: there is exactly one byte string a verifier could be
 * checking, and it is already the thing `manifest-builder.js` froze.
 *
 * WHY ECDSA P-256 RATHER THAN RSA
 * Natively supported by Web Crypto, ~64-byte signatures that fit comfortably in
 * a manifest and a `.sig` file, and universally implemented in verification
 * tooling.
 *
 * WHAT A VALID SIGNATURE PROVES, AND WHAT IT DOES NOT
 * It proves the manifest hash was signed by the holder of the matching private
 * key and has not changed since. It does not establish who that holder is: the
 * public key travels inside the package it authenticates, so a self-signed
 * manifest can only demonstrate internal consistency. Any real trust anchor has
 * to come from outside the package.
 */

import { base64ToBytes, bytesToBase64 } from "./hash.js";

const ECDSA_KEY_PARAMS = { name: "ECDSA", namedCurve: "P-256" };
const ECDSA_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" };

/** A SHA-256 digest is 32 bytes, so its hex form is 64 characters. */
const MANIFEST_HASH_HEX_LENGTH = 64;

/**
 * Sign a manifest hash.
 *
 * @param {string} hashHex 64-character hex SHA-256 digest
 * @param {CryptoKey} privateKey non-extractable ECDSA P-256 private key
 * @returns {Promise<string>} base64 signature
 */
export async function signManifestHash(hashHex, privateKey) {
  if (typeof hashHex !== "string" || hashHex.length !== MANIFEST_HASH_HEX_LENGTH) {
    throw new TypeError(
      `signManifestHash: expected a ${MANIFEST_HASH_HEX_LENGTH}-character hex digest`
    );
  }
  if (!privateKey) {
    throw new TypeError("signManifestHash: a private key is required");
  }

  const signature = await crypto.subtle.sign(
    ECDSA_SIGN_PARAMS,
    privateKey,
    hexToBytes(hashHex)
  );
  return bytesToBase64(new Uint8Array(signature));
}

/**
 * Verify a manifest signature using a public key supplied by the caller.
 *
 * The key comes from the manifest being checked, never from the local keystore.
 * That is what lets a third party verify an exported package on a machine that
 * has never seen this vault — and it means a lost vault does not render past
 * evidence unverifiable.
 *
 * Never throws. Every malformed input — a bad hex digest, unparseable base64, a
 * wrong-curve or malformed JWK — is an unverified signature, not an exception,
 * because the verifier reports a per-check boolean and must be able to say
 * "signature invalid" rather than crashing the whole verification.
 *
 * @param {string} hashHex 64-character hex SHA-256 digest
 * @param {string} sigB64 base64 signature
 * @param {JsonWebKey} publicKeyJwk public key taken from the manifest
 * @returns {Promise<boolean>}
 */
export async function verifyManifestSignature(hashHex, sigB64, publicKeyJwk) {
  return (await inspectManifestSignature(hashHex, sigB64, publicKeyJwk)).ok;
}

/**
 * Like `verifyManifestSignature`, but distinguishes *why* a signature did not
 * verify. The verifier (step 08) needs this because its reported detail strings
 * separate "signature invalid" from "public key malformed"; a third party only
 * needs the boolean above.
 *
 * Never throws.
 *
 * @param {string} hashHex 64-character hex SHA-256 digest
 * @param {string} sigB64 base64 signature
 * @param {JsonWebKey} publicKeyJwk public key taken from the manifest
 * @returns {Promise<{ ok: boolean, reason: "valid"|"invalid"|"key_malformed"|"bad_input" }>}
 */
export async function inspectManifestSignature(hashHex, sigB64, publicKeyJwk) {
  if (typeof hashHex !== "string" || !/^[0-9a-f]{64}$/i.test(hashHex)) {
    return { ok: false, reason: "bad_input" };
  }
  if (typeof sigB64 !== "string" || sigB64.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  if (!publicKeyJwk || typeof publicKeyJwk !== "object") {
    return { ok: false, reason: "key_malformed" };
  }

  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey(
      "jwk",
      publicKeyJwk,
      ECDSA_KEY_PARAMS,
      false,
      ["verify"]
    );
  } catch {
    return { ok: false, reason: "key_malformed" };
  }

  let signatureBytes;
  try {
    signatureBytes = base64ToBytes(sigB64);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  try {
    const ok = await crypto.subtle.verify(
      ECDSA_SIGN_PARAMS,
      publicKey,
      signatureBytes,
      hexToBytes(hashHex)
    );
    return { ok, reason: ok ? "valid" : "invalid" };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Decode a hex string into bytes.
 *
 * @param {string} hex even-length string of hex digits
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  if (typeof hex !== "string") {
    throw new TypeError("hexToBytes: expected a hex string");
  }
  if (hex.length % 2 !== 0) {
    throw new TypeError("hexToBytes: expected an even number of hex digits");
  }
  if (!/^[0-9a-f]*$/i.test(hex)) {
    // parseInt would quietly return NaN for a non-hex pair, producing a byte of
    // 0 and a signature over the wrong input.
    throw new TypeError("hexToBytes: expected hex digits only");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
