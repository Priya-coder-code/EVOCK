/**
 * EVOCK — Evidence Manifest v1.0 builder (Role B, B2).
 *
 * Builds the object that gets hashed and signed, and computes the dual-hash
 * hierarchy that lets verification say *what* changed rather than just "something
 * changed":
 *
 *        EVIDENCE PACKAGE
 *               |
 *      +--------+--------+
 *      v                 v
 *  SCREENSHOT        METADATA
 *      |                 |
 *   HASH A            HASH B
 *      +--------+--------+
 *               v
 *            HASH C  (manifest)
 *
 * HASHING ORDER — FROZEN. Implemented exactly as specified in
 * Plan/Building Plan.md §5.3. Once the first record is stored with
 * schema_version "1.0", changing any of this means a "1.1" and a migration path,
 * because old records must still verify.
 *
 *   1. screenshot_hash = sha256Bytes( dataUrlToBytes(capture.screenshotDataUrl) )
 *                        // raw bytes, BEFORE encryption
 *   2. metadata_hash   = sha256Canonical( manifest.ai_derived_metadata )
 *                        // includes provider, model and status
 *   3. manifest_hash   = sha256Canonical( reduceManifestForHashing(manifest) )
 *                        // manifest without integrity.manifest_hash and without signature
 *
 * WHY THE SCREENSHOT IS HASHED BEFORE ENCRYPTION
 * Ciphertext changes on every re-encryption because the IV is fresh each time,
 * so a ciphertext hash is not a stable identity for the artifact. The plaintext
 * hash is. AES-GCM's own authentication tag covers ciphertext integrity
 * separately, so nothing is lost by hashing the plaintext.
 *
 * WHY THE DATA URL IS DECODED FIRST
 * Hashing the base64 text would tie the fingerprint to data-URL formatting, and
 * it would not match what an investigator gets when they hash the exported PNG.
 *
 * WHY manifest_hash AND signature ARE EXCLUDED FROM THE MANIFEST HASH
 * A field cannot contain a hash of itself. The manifest is built, the reduced
 * object is hashed, and only then are manifest_hash and the signature written in.
 *
 * WHY THE WHOLE ai_derived_metadata BLOCK IS HASHED
 * provider, model and status are hashed alongside the extracted data, because
 * the provenance of the derived data is part of what we are protecting — not
 * just the text. Changing "vision" to "demo" after the fact must be detectable.
 */

import { dataUrlToBytes, sha256Bytes, sha256Canonical } from "../crypto/hash.js";

/** @type {"1.0"} */
export const SCHEMA_VERSION = "1.0";

/**
 * Build an Evidence Manifest and its three fingerprints.
 *
 * The returned manifest carries a placeholder signature block: `signature` and
 * `signed_at` are null until `attachSignature` is called with a real signature
 * over `manifest_hash`.
 *
 * @param {{
 *   capture: import("../shared/types.js").CaptureResult,
 *   extraction: import("../shared/types.js").ExtractionResult,
 *   evidence_id: string|null,
 *   iv_b64: string,
 *   public_key_jwk: object
 * }} args
 * @returns {Promise<{
 *   manifest: import("../shared/types.js").EvidenceManifest,
 *   screenshot_hash: string,
 *   metadata_hash: string,
 *   manifest_hash: string,
 *   screenshotBytes: Uint8Array
 * }>}
 */
export async function buildManifest({
  capture,
  extraction,
  evidence_id = null,
  iv_b64,
  public_key_jwk
}) {
  if (!capture || typeof capture !== "object") {
    throw new TypeError("buildManifest: capture is required");
  }
  if (!extraction || typeof extraction !== "object") {
    throw new TypeError("buildManifest: extraction is required");
  }
  // A manifest without an IV hashes and verifies perfectly happily, and its
  // screenshot can never be decrypted again — the evidence is lost while
  // verification still reports VERIFIED. Canonicalisation drops an `undefined`
  // key silently, so this has to be caught here.
  if (typeof iv_b64 !== "string" || iv_b64.length === 0) {
    throw new TypeError(
      "buildManifest: iv_b64 is required — a manifest without an IV yields an undecryptable screenshot"
    );
  }
  // The public key is excluded from manifest_hash, so a missing one costs no
  // hash mismatch; it just makes the exported package unverifiable by anyone who
  // does not already hold this vault (Role B.md §7, item 8).
  if (!public_key_jwk || typeof public_key_jwk !== "object") {
    throw new TypeError(
      "buildManifest: public_key_jwk is required — an exported package must be verifiable without this vault"
    );
  }

  // 1. Screenshot: decoded bytes, hashed before any encryption happens.
  const screenshotBytes = dataUrlToBytes(capture.screenshotDataUrl);
  const screenshot_hash = await sha256Bytes(screenshotBytes);

  // 2. Derived metadata, provenance included.
  const ai_derived_metadata = {
    // The contract (Building Plan §5.2) says provider is "demo" | "vision".
    // It is passed through exactly as received and never rewritten here: this
    // value is hashed, so silently normalising it would make the manifest
    // disagree with the ExtractionResult it came from.
    // TODO(role-a): service-worker.js emits provider "unknown" on an unexpected
    // extraction error, which is outside the §5.2 enum. Reconcile in step 10.
    provider: extraction.provider,
    model: extraction.model ?? null,
    status: extraction.status,
    extracted_at: extraction.extractedAt ?? null,
    data: extraction.data ?? null
  };
  const metadata_hash = await sha256Canonical(ai_derived_metadata);

  /** @type {import("../shared/types.js").EvidenceManifest} */
  const manifest = {
    schema_version: SCHEMA_VERSION,
    // Whatever id is passed in is part of the signed manifest. It must never be
    // rewritten afterwards — doing so would invalidate manifest_hash and report
    // tamper on a clean record. See the note in reduceManifestForHashing.
    evidence_id,
    source: {
      capture_method: capture.captureMethod,
      url: capture.url,
      domain: capture.domain,
      tab_title: capture.tabTitle
    },
    capture: {
      device_captured_at: capture.capturedAt,
      screenshot_width: capture.width,
      screenshot_height: capture.height,
      mime_type: capture.mimeType
    },
    visual_artifact: {
      type: "screenshot",
      storage: "encrypted",
      encryption: {
        algorithm: "AES-GCM",
        key_length: 256,
        iv: iv_b64
      }
    },
    ai_derived_metadata,
    integrity: {
      hash_algorithm: "SHA-256",
      screenshot_hash,
      metadata_hash,
      // Excluded from its own input; written in below.
      manifest_hash: null
    },
    signature: {
      algorithm: "ECDSA-P256-SHA256",
      public_key_jwk,
      signature: null,
      signed_at: null
    },
    timestamp: {
      device_capture_time: capture.capturedAt,
      trusted_timestamp_status: "not_configured",
      trusted_timestamp_token: null
    }
  };

  // 3. Manifest hash over the reduced object, then written back in.
  const manifest_hash = await sha256Canonical(reduceManifestForHashing(manifest));
  manifest.integrity.manifest_hash = manifest_hash;

  return { manifest, screenshot_hash, metadata_hash, manifest_hash, screenshotBytes };
}

/**
 * Produce the exact object that `manifest_hash` is computed over: the manifest
 * without `integrity.manifest_hash` and without `signature`.
 *
 * This function is the shared contract between creation and verification. The
 * verifier MUST call this same function rather than re-implementing the
 * reduction — two implementations drift, and drift here produces false
 * "MODIFICATION DETECTED" on untouched evidence.
 *
 * The keys are deleted rather than set to null, because canonicalisation
 * preserves null and would otherwise hash a `"manifest_hash":null` member that
 * the verifier's input does not contain.
 *
 * The input is not mutated.
 *
 * @param {import("../shared/types.js").EvidenceManifest} manifest
 * @returns {object} reduced copy, safe to canonicalise
 */
export function reduceManifestForHashing(manifest) {
  if (!manifest || typeof manifest !== "object") {
    throw new TypeError("reduceManifestForHashing: expected a manifest object");
  }

  const reduced = { ...manifest };
  delete reduced.signature;

  if (reduced.integrity && typeof reduced.integrity === "object") {
    reduced.integrity = { ...reduced.integrity };
    delete reduced.integrity.manifest_hash;
  }

  return reduced;
}

/**
 * Write the signature block onto a manifest whose `manifest_hash` is already
 * computed. Mutates and returns the manifest.
 *
 * Nothing may modify the manifest after this point. If a user later edits the
 * AI-derived metadata, that must produce a NEW version with its own hashes and
 * signature, with the original preserved — a correction is an event, not an
 * erasure (spec §26.4).
 *
 * Note the limitation this design carries: the whole `signature` block,
 * including `public_key_jwk`, is excluded from `manifest_hash`, so the embedded
 * public key is not itself covered by the signature. A self-signed manifest can
 * only prove internal consistency; it cannot anchor trust in the signer. That
 * anchor has to come from outside the package.
 *
 * @param {import("../shared/types.js").EvidenceManifest} manifest
 * @param {{ signature_b64: string, public_key_jwk?: object, signed_at: string }} args
 * @returns {import("../shared/types.js").EvidenceManifest}
 */
export function attachSignature(manifest, { signature_b64, public_key_jwk, signed_at }) {
  if (!manifest?.integrity?.manifest_hash) {
    throw new TypeError(
      "attachSignature: manifest_hash must be computed before a signature is attached"
    );
  }

  manifest.signature = {
    algorithm: "ECDSA-P256-SHA256",
    public_key_jwk: public_key_jwk ?? manifest.signature?.public_key_jwk ?? null,
    signature: signature_b64,
    signed_at
  };

  return manifest;
}
