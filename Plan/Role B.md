# Role B — Evidence Core (Cryptography & Vault)

**Slice:** The middle of the pipeline — everything from "we have a capture and an extraction" to "there is a tamper-evident, encrypted, verifiable record in the vault".
**Owns:** canonicalisation, dual SHA-256 hashing, the manifest builder, the ECDSA keystore and signing, AES-GCM encryption, the IndexedDB vault repository, the verification engine, the timestamp abstraction, and the tamper-demo harness.
**Consumes:** `CaptureResult` + `ExtractionResult` from Role A.
**Hands off to:** Role C via `StoredEvidenceRecord` and `VerificationResult`.
**Depends on:** nothing at runtime — you build entirely against `tests/fixtures/` from the start.

> Read `Building Plan.md` §5.3–§5.5 before writing code. You own the hashing order specified there; it is not negotiable once the first record is stored.

---

## 1. Why this slice exists

This is the only part of EVOCK that makes a claim nobody else can make. Capture is a screenshot. Extraction is a model call. **The cryptographic lock is the product.**

It is also the slice where a subtle bug is silently catastrophic. If canonicalisation is non-deterministic, verification produces false "MODIFICATION DETECTED" on untouched evidence — and a tool that cries tamper on its own records is worse than no tool. Your work is therefore judged on determinism and test coverage far more than on features.

Second, this slice defines what EVOCK is allowed to *say*. SHA-256 proves that bytes did not change. It does not prove the conversation happened, that the account belongs to a person, or that a court will accept the package. You are the person best placed to catch over-claiming in the UI copy — do it during review.

---

## 2. Files you own

```text
extension/src/evidence/canonicalize.js
extension/src/evidence/manifest-builder.js
extension/src/crypto/hash.js
extension/src/crypto/keystore.js
extension/src/crypto/sign.js
extension/src/crypto/encrypt.js
extension/src/crypto/timestamp.js
extension/src/storage/db.js
extension/src/storage/vault-repo.js
extension/src/verify/verifier.js
extension/src/shared/ids.js
tests/crypto/*.test.js
tests/storage/*.test.js
tests/verify/*.test.js
```

You publish one high-level function that Role A calls from the orchestrator:

```js
/** @returns {Promise<StoredEvidenceRecord>} */
export async function lockEvidence({ capture, extraction, emit })
```

and one that Role C calls from the vault UI:

```js
/** @returns {Promise<VerificationResult>} */
export async function verifyEvidence(evidence_id)
```

---

## 3. Work plan

### B1 — Canonicalisation (P1 — do this first)

`evidence/canonicalize.js` exports:

```js
/** @param {any} value @returns {string} deterministic JSON */
export function canonicalize(value)
```

Rules (an RFC 8785 / JCS-style subset, hand-written — no dependency needed):

- Object keys sorted lexicographically by UTF-16 code unit, recursively.
- No insignificant whitespace.
- Arrays keep their order (order is meaningful for `messages`).
- `null` is preserved; `undefined` keys are **dropped**, and any function/symbol value is an error, not a silent drop.
- Numbers: integers only in our schema. If a float ever appears, serialise with the shortest round-trip representation — do not use locale formatting.
- Strings: standard JSON escaping, UTF-8 encoded to bytes via `TextEncoder` before hashing (never hash a JS string directly).

Write the tests before the implementation:
- The same object with keys inserted in 10 different orders → 10 identical outputs.
- Nested objects and arrays of objects.
- `null` vs missing vs empty string produce three different outputs.
- Unicode: emoji, RTL text, combining characters — a message may contain any of these and must round-trip byte-identically.

**Why it matters:** `JSON.stringify` preserves insertion order. Role A builds the metadata object in one order; the verifier rebuilds it in another; the hashes differ; the product reports tamper on clean evidence. This 40-line function is the load-bearing wall.

### B2 — Hashing and the manifest (P1–P2)

`crypto/hash.js`:

```js
export async function sha256Bytes(arrayBuffer)   // → hex string
export async function sha256Utf8(string)         // TextEncoder → sha256Bytes
export async function sha256Canonical(object)    // canonicalize → sha256Utf8
```

Use `crypto.subtle.digest("SHA-256", …)` — never a userland SHA implementation.

`evidence/manifest-builder.js` builds `EvidenceManifest` v1.0 (`Building Plan.md` §5.3) and computes the dual hash in exactly this order:

```text
1. screenshot_hash = sha256Bytes( raw screenshot bytes, BEFORE encryption )
2. metadata_hash   = sha256Canonical( manifest.ai_derived_metadata )
3. manifest_hash   = sha256Canonical( manifest WITHOUT integrity.manifest_hash AND WITHOUT signature )
```

Non-obvious points that must be written as comments in the code:

- **Hash the screenshot before encryption, not after.** Ciphertext changes on every re-encryption (new IV); the plaintext hash is the stable identity of the artifact. AES-GCM's own auth tag covers ciphertext integrity separately.
- **Convert the data URL to raw bytes first.** Hashing the base64 string instead of the decoded bytes would make the hash depend on data-URL formatting, and would not match what an investigator gets when they hash the exported PNG.
- **Exclude `manifest_hash` and `signature` from the manifest hash input.** A field cannot contain a hash of itself. Build the manifest, hash the reduced object, then write the hash and signature in.
- Hash the `ai_derived_metadata` block **including** `provider`, `model` and `status` — the provenance of the derived data is part of what we are protecting, not just the text.

The dual-hash hierarchy exists so verification can say *what* changed:

```text
       EVIDENCE PACKAGE
              │
     ┌────────┴────────┐
     ▼                 ▼
 SCREENSHOT        METADATA
     │                 │
  HASH A            HASH B
     └────────┬────────┘
              ▼
           HASH C  (manifest)
```

### B3 — Keystore and signing (P2)

`crypto/keystore.js`:

- On first run, `crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])`.
- **`extractable: false` for the private key.** It never leaves the browser as raw material — not to a log, not to an export, not to the bridge.
- Persist the `CryptoKey` object directly in IndexedDB. Structured clone supports `CryptoKey`, so a non-extractable key can be stored and reloaded without ever being serialised into readable bytes. This is the reason we use IndexedDB rather than `chrome.storage` for the key.
- Export the **public** key as JWK and embed it in every manifest.

`crypto/sign.js`:

```js
export async function signManifestHash(hashHex, privateKey)   // → base64 signature
export async function verifyManifestSignature(hashHex, sigB64, publicKeyJwk) // → boolean
```

- Algorithm: `{ name: "ECDSA", hash: "SHA-256" }` over the **bytes of the manifest hash**, not over the whole manifest. Signing a fixed 32-byte input keeps signing cheap and the input unambiguous.
- Verification must accept the public key **from the manifest itself**, not from the local keystore. This is what lets a third party verify an exported package on a machine that has never seen our vault.

Why ECDSA P-256 rather than RSA: natively supported by Web Crypto, small signatures (~64 bytes) that fit comfortably in a manifest and a `.sig` file, and universally implemented in verification tooling.

### B4 — Encryption (P2)

`crypto/encrypt.js`:

```js
export async function encryptBlob(arrayBuffer, key)  // → { ciphertext, iv }
export async function decryptBlob(ciphertext, iv, key)
```

- AES-GCM, 256-bit key, **fresh random 96-bit IV per record** from `crypto.getRandomValues`. IV reuse under GCM is a real break, not a style issue — generate it inside the function so a caller cannot pass a constant.
- Store the IV in the manifest (`visual_artifact.encryption.iv`, base64). An IV is not secret; it must not be lost.
- The vault key is a generated non-extractable `CryptoKey` in the keystore for the MVP.
- If we add a passphrase-locked vault later, derive the key with PBKDF2-SHA-256 (high iteration count, random per-vault salt) — build the seam now by putting key acquisition behind `getVaultKey()`, so the derivation path is a swap rather than a refactor.

Why AES-GCM specifically: it is authenticated encryption, so the ciphertext carries its own integrity tag. A corrupted or modified `.enc` file fails to decrypt rather than yielding garbage that we might mistake for evidence.

### B5 — Timestamp abstraction (P2)

`crypto/timestamp.js`:

```js
export const DeviceTimestampProvider = { id: "device", async stamp(hashHex) { … } };
// returns { device_capture_time, trusted_timestamp_status: "not_configured", trusted_timestamp_token: null }
```

Build the interface, implement only the device provider. The `TrustedTimestampProvider` (RFC 3161) is a future plug-in.

**The rule that matters more than the code:** device time and trusted time are separate fields with separate names, and the UI must never present device time as a trusted timestamp. Flag it in review if you see it (spec §25.11, §36).

### B6 — IndexedDB vault (P2)

`storage/db.js` — schema and upgrades:

```text
DB: evock-vault   version: 1
├── objectStore "evidence"  keyPath "evidence_id"
│     index "by_created_at"      → created_at
│     index "by_platform"        → platform_label
├── objectStore "keys"      keyPath "id"      // "signing", "vault"
└── objectStore "settings"  keyPath "key"
```

`storage/vault-repo.js` — the only module allowed to touch IndexedDB:

```js
put(record)                 // atomic single write, whole record or nothing
get(evidence_id)            // full record including ciphertext
list({ sort, filter })      // metadata only — NEVER loads ciphertext
getDecryptedScreenshot(id)  // → Blob, for the detail view
updateVerification(id, result)
remove(id)                  // explicit user action only
count()
```

Design points:

- `list()` must not read screenshot blobs. A vault of 50 records would otherwise pull hundreds of megabytes into memory to render a list. Use an index cursor over metadata only.
- One transaction per `put`. A half-written record is worse than a failed capture, because it looks real.
- `evidence_id` from `shared/ids.js`: zero-padded sequential (`NK-0001`) derived from a counter in `settings`, allocated inside the same transaction as the write so two rapid captures cannot collide.
- Handle `QuotaExceededError` explicitly and surface a real message to Role C's UI. Silent storage failure is unacceptable in an evidence tool.

### B7 — Verification engine (P4)

`verify/verifier.js`:

```js
export async function verifyEvidence(evidence_id) // → VerificationResult
```

Steps, in order:

1. Load the record.
2. Decrypt the screenshot; recompute `sha256Bytes` → compare to `integrity.screenshot_hash`.
3. Recompute `sha256Canonical(ai_derived_metadata)` → compare to `integrity.metadata_hash`.
4. Rebuild the reduced manifest (strip `manifest_hash` and `signature` exactly as the builder does) → recompute → compare to `integrity.manifest_hash`.
5. Verify the ECDSA signature over `manifest_hash` using **the public key stored in the manifest**.
6. Aggregate: `VERIFIED` only if all four are true; `MODIFIED` if any comparison fails; `ERROR` if something could not be evaluated (decryption threw, key malformed).

`details[]` must name the specific failure — `"metadata_hash mismatch"`, `"signature invalid"` — because Role C's UI shows *what* changed, and because "something is wrong" is useless to an investigator.

**Critical implementation rule:** steps 3 and 4 must call the *same* `manifest-builder` reduction function used at creation time. If verification re-implements the reduction, the two will drift and produce false negatives. Export the reduction as a named function and call it from both sides.

### B8 — Tamper-demo harness (P4)

A dev-build-only function, gated behind a build flag so it cannot ship:

```js
export async function __tamperDemo(evidence_id, mode) // "modify_metadata" | "modify_screenshot" | "restore"
```

It writes a modified record back to IndexedDB *without* recomputing hashes — exactly what an attacker editing the stored file would do. Keep an untouched copy so `restore` returns the record to its original bytes.

This drives the spec §18 demo:

```text
RECORDED HASH  83A91F…
CURRENT HASH   B72C19…
❌ MODIFICATION DETECTED  (metadata_hash mismatch)
```

then restore, verify again, `✓ INTEGRITY VERIFIED`. This 30-second sequence is the single most persuasive thing in the entire demo — build it deliberately, not as an afterthought.

---

## 4. Tools you use, and why

| Tool | What you use it for | Why this one |
|---|---|---|
| **Web Crypto API (`crypto.subtle`)** | All hashing, signing, encryption | Native, audited, hardware-accelerated. Hand-rolled crypto in an evidence tool is indefensible |
| **SHA-256** | Screenshot, metadata and manifest fingerprints | Universally recognised; its guarantee is exactly the claim we make — *if the bytes change, the fingerprint changes*. Nothing more |
| **Dual hashing (A + B → C)** | Telling *what* changed | A single blob hash says "something changed". Separate hashes distinguish an altered screenshot from altered AI metadata — far more useful to an investigator |
| **Deterministic canonicalisation (JCS-style)** | Stable input to every hash | `JSON.stringify` is insertion-order dependent; without canonicalisation, verification produces false tamper alerts on untouched records |
| **`TextEncoder`** | String → UTF-8 bytes | Hashes are over bytes. Encoding must be explicit and identical on both the create and verify paths |
| **ECDSA P-256 + SHA-256** | Digital signature over the manifest hash | Natively supported by Web Crypto, ~64-byte signatures that fit in a manifest and a `.sig` file, and widely verifiable by third-party tooling |
| **Non-extractable `CryptoKey`** | Private signing key | The private key can be used but never read out — not by our code, not by an exfiltration bug. Structured clone lets us persist it in IndexedDB without ever serialising key material |
| **Public key embedded in the manifest (JWK)** | Third-party verification | An exported package must be verifiable on a machine that has never seen this vault |
| **AES-GCM 256** | Encrypting the screenshot at rest | Authenticated encryption: confidentiality plus a built-in integrity tag, so tampered ciphertext fails to decrypt instead of yielding plausible garbage |
| **`crypto.getRandomValues`** | Per-record 96-bit IV | CSPRNG. IV uniqueness is a hard requirement under GCM |
| **PBKDF2-SHA-256** (seam only) | Future passphrase-locked vault | Standard KDF available in Web Crypto; we build `getVaultKey()` now so adding it later is a swap, not a refactor |
| **IndexedDB** | The evidence vault and keystore | Only browser store that holds large binaries with real indexes, survives restarts, and can persist `CryptoKey` objects via structured clone |
| **`idb` wrapper** (optional) | Readable transactions | ~1 KB; turns callback-heavy IndexedDB into promises. Skip it and hand-roll if we want zero dependencies here — your call, but decide once |
| **RFC 3161 `TimestampProvider` interface** | Future trusted timestamping | Building the seam now keeps the manifest schema stable when a real TSA is added, and enforces the device-time/trusted-time distinction from the outset |
| **Vitest + Node 20 `crypto.subtle`** | Unit tests, headless | Your modules are pure functions over bytes; they can and must be tested without a browser |

---

## 5. Contracts you must not break

You **consume** `CaptureResult` and `ExtractionResult`; you **produce** `EvidenceManifest`, `StoredEvidenceRecord` and `VerificationResult`.

- Once the first record is written with `schema_version: "1.0"`, the hashing order and the reduction rule are frozen. Any change means a `1.1` and a migration path — old records must still verify.
- `VerificationResult.details[]` strings are read by Role C's UI. Agree the exact wording once and keep it stable.
- Never mutate the manifest after signing. If a user edits AI metadata (Role C's review feature), that must produce a **new** version with its own hashes and signature, and the original must remain in the record's history — a correction is an event, not an erasure (spec §26.4).

---

## 6. Testing your slice

This slice has the highest test bar in the project. Non-negotiable coverage:

- **Canonicalisation:** key-order permutations, nesting, unicode/emoji/RTL, `null` vs missing vs `""`, arrays of objects.
- **Hashing:** known-answer tests (hash a fixed string, compare to a precomputed digest); the same manifest hashed twice in the same process and across a reload produces the same value.
- **Round trip:** build → sign → encrypt → store → load → decrypt → verify → `VERIFIED`. Run it 100 times in a loop; a flake here is a real bug, not test noise.
- **Tamper matrix:** flip one byte of the screenshot; change one character of one message; change `provider` from `vision` to `demo`; re-order the `messages` array; corrupt the signature. Each must produce `MODIFIED` with the correct `details` entry — and the metadata-only cases must leave `screenshot_hash_ok: true`.
- **Cross-key:** verify a manifest with the wrong public key → `signature_ok: false`, not a thrown exception.
- **Storage:** concurrent `put`s do not collide on `evidence_id`; `list()` does not load ciphertext (assert on memory or on the fields returned); `QuotaExceededError` surfaces as a typed error.

---

## 7. Definition of done

1. `canonicalize()` is deterministic across key order, unicode, and process restarts, with tests proving it.
2. All three hashes are computed in the specified order, with the screenshot hashed pre-encryption from decoded bytes.
3. A signing keypair is generated once, persisted non-extractably, and its public key appears in every manifest.
4. Every record's screenshot is AES-GCM encrypted with a unique IV stored in the manifest.
5. `lockEvidence()` is a single call that Role A can make, and it is atomic — success writes one complete record, failure writes none.
6. `verifyEvidence()` returns `VERIFIED` on untouched records 100/100 times.
7. Every entry in the tamper matrix returns `MODIFIED` with the correct specific `details`.
8. An exported package verifies using only the manifest's embedded public key, on a profile with an empty vault.
9. Device time and trusted-timestamp status are separate fields, and nothing in the codebase calls device time "trusted".
10. `list()` renders a 50-record vault without loading a single screenshot into memory.
