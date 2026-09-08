/**
 * EVOCK — SHA-256 primitives (Role B, B2).
 *
 * Every fingerprint in the evidence core is produced here. SHA-256 is used for
 * one claim and one claim only: if the bytes change, the fingerprint changes.
 * It says nothing about whether the conversation happened, who owns an account,
 * or whether a court will accept the package.
 *
 * All hashing goes through `crypto.subtle.digest("SHA-256", …)`. A userland SHA
 * implementation in an evidence tool is indefensible.
 */

import { canonicalize } from "../evidence/canonicalize.js";

/**
 * Hash raw bytes.
 *
 * Accepts an ArrayBuffer or any typed-array view; a view's byteOffset and
 * byteLength are respected, so a subarray hashes only its own bytes.
 *
 * @param {ArrayBuffer|ArrayBufferView} arrayBufferOrView
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256Bytes(arrayBufferOrView) {
  if (typeof arrayBufferOrView === "string") {
    // Hashing a JS string directly is the single easiest way to make the create
    // and verify paths disagree, because it leaves the encoding implicit.
    throw new TypeError(
      "sha256Bytes: refusing to hash a string. Use sha256Utf8() to encode it as UTF-8 first."
    );
  }
  if (
    !(arrayBufferOrView instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(arrayBufferOrView)
  ) {
    throw new TypeError("sha256Bytes: expected an ArrayBuffer or a typed-array view");
  }

  const digest = await crypto.subtle.digest("SHA-256", arrayBufferOrView);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Hash the UTF-8 bytes of a string.
 *
 * Encoding is explicit and identical on the create and verify paths — that is
 * the whole point of this function existing separately from `sha256Bytes`.
 *
 * @param {string} value
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256Utf8(value) {
  if (typeof value !== "string") {
    throw new TypeError("sha256Utf8: expected a string");
  }
  return sha256Bytes(new TextEncoder().encode(value));
}

/**
 * Hash a value through its canonical JSON form.
 *
 * This is the only correct way to hash a structured object in EVOCK:
 * canonicalise, encode as UTF-8, then digest the bytes. Hashing
 * `JSON.stringify` output instead would make the digest depend on key insertion
 * order and produce false "MODIFICATION DETECTED" on untouched records.
 *
 * @param {any} value
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256Canonical(value) {
  return sha256Utf8(canonicalize(value));
}

/**
 * Decode a base64 `data:` URL into its raw bytes.
 *
 * The screenshot must be hashed as the bytes an investigator would get from the
 * exported PNG — not as the base64 text, which would tie the fingerprint to
 * data-URL formatting.
 *
 * Implemented with `atob` rather than `fetch(dataUrl)` so it behaves identically
 * in an MV3 service worker and in the headless test environment.
 *
 * @param {string} dataUrl
 * @returns {Uint8Array} raw decoded bytes
 */
export function dataUrlToBytes(dataUrl) {
  if (typeof dataUrl !== "string") {
    throw new TypeError("dataUrlToBytes: expected a data URL string");
  }

  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex === -1) {
    throw new TypeError("dataUrlToBytes: not a data URL");
  }

  const header = dataUrl.slice(0, commaIndex);
  if (!/;base64$/i.test(header)) {
    // A percent-encoded data URL would decode to different bytes through atob,
    // or throw. Reject it rather than fingerprinting something unintended.
    throw new TypeError("dataUrlToBytes: expected a base64-encoded data URL");
  }

  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hex
 */
export function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
