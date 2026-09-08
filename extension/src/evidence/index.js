/**
 * EVOCK — Evidence Core public surface (Role B).
 *
 * Role A's service worker and Role C's vault/export UI import from here, not
 * from the individual modules. Everything below is a committed contract; the
 * internals behind it (canonicalisation, the keystore, the vault schema) are
 * not.
 *
 *   lockEvidence({ capture, extraction, emit })  -> StoredEvidenceRecord
 *     One atomic call: hash -> encrypt -> build -> sign -> timestamp -> store.
 *     Throws on any failure and writes nothing; the caller owns the
 *     screenshot-only fallback.
 *
 *   verifyEvidence(evidence_id, { persist })     -> VerificationResult
 *     Recomputes every fingerprint and checks the signature. Never rejects for
 *     a tampered record — that is a result with status MODIFIED or ERROR.
 *
 *   verifyManifestSignature(hashHex, sigB64, jwk) -> boolean
 *   reduceManifestForHashing(manifest)            -> reduced copy
 *     The two primitives a third party needs to verify an exported package with
 *     nothing but its manifest.json and screenshot bytes.
 *
 *   VERIFY_DETAILS
 *     Frozen detail strings; Role C's UI renders them verbatim.
 */

export { lockEvidence } from "./lock-evidence.js";
export { verifyEvidence, VERIFY_DETAILS } from "../verify/verifier.js";
export { verifyManifestSignature } from "../crypto/sign.js";
export { reduceManifestForHashing } from "./manifest-builder.js";
