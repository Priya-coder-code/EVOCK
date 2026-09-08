# Role B — Evidence Core: status and handoff

**Branch:** `feat/role-b/test-foundation` (13 commits off `main`, not yet pushed)
**Tests:** `npm test` → 291 passing, 0 failing, across `tests/{evidence,crypto,storage,verify}`
**Files touched:** new modules only. No Role A file modified.

---

## 1. Public surface

Role A and Role C import from **`extension/src/evidence/index.js`**, never the internals.

```js
import {
  lockEvidence,               // ({ capture, extraction, emit? }) -> Promise<StoredEvidenceRecord>
  verifyEvidence,             // (evidence_id, { persist = true }) -> Promise<VerificationResult>
  verifyManifestSignature,    // (hashHex, sigB64, jwk) -> Promise<boolean>
  reduceManifestForHashing,   // (manifest) -> reduced copy (for third-party verification)
  VERIFY_DETAILS              // frozen detail strings
} from "./evidence/index.js";
```

`vault-repo` is also public for Role C's list/detail views:

```js
import * as vaultRepo from "./storage/vault-repo.js";
// list({ sort, filter }) · get(id) · getDecryptedScreenshot(id) -> Blob
// updateVerification(id, result) · remove(id) · count() · VaultQuotaError
```

Dev-only: `verify/tamper-demo.js` → `__tamperDemo(id, mode)`. Gated behind
`globalThis.__EVOCK_DEV__` / `import.meta.env.DEV`; nothing in production imports it.

---

## 2. Modules delivered

| Module | Responsibility |
|---|---|
| `evidence/canonicalize.js` | Deterministic JCS-style JSON. Zero deps. The load-bearing wall. |
| `crypto/hash.js` | `sha256Bytes` / `sha256Utf8` / `sha256Canonical`; `dataUrlToBytes`; hex + base64 codecs. |
| `evidence/manifest-builder.js` | `buildManifest`, `reduceManifestForHashing`, `attachSignature`. Owns the frozen hashing order. |
| `crypto/keystore.js` | One non-extractable ECDSA P-256 keypair per vault, persisted as a `CryptoKey`. |
| `crypto/sign.js` | `signManifestHash`, `verifyManifestSignature`, `inspectManifestSignature`, `hexToBytes`. |
| `crypto/encrypt.js` | AES-GCM 256, `getVaultKey` seam, per-record IV generated internally. |
| `crypto/timestamp.js` | `DeviceTimestampProvider` + stubbed `TrustedTimestampProvider`. |
| `storage/db.js` | IndexedDB schema v1 + promise wrappers. No `idb` dependency. |
| `storage/vault-repo.js` | The only module that reads/writes evidence records. |
| `shared/ids.js` | `nextEvidenceId(tx)` — collision-free `NK-0001` sequence. |
| `shared/iso-time.js` | `nowIso()` — ISO-8601 with local offset. |
| `verify/verifier.js` | `verifyEvidence` + frozen `VERIFY_DETAILS`. |
| `verify/tamper-demo.js` | Dev-only §18 demo harness. |

---

## 3. Frozen contracts

### Hashing order (`manifest-builder.js`, Building Plan §5.3) — frozen at `schema_version: "1.0"`

```
screenshot_hash = SHA256( dataUrlToBytes(capture.screenshotDataUrl) )   // decoded bytes, pre-encryption
metadata_hash   = SHA256( canonicalize( ai_derived_metadata ) )         // includes provider, model, status
manifest_hash   = SHA256( canonicalize( reduceManifestForHashing(manifest) ) )
                                        // manifest minus integrity.manifest_hash and signature
signature       = ECDSA-P256-SHA256( bytes of manifest_hash )
```

`evidence_id` is inside the manifest and therefore covered by `manifest_hash`.
`lockEvidence` allocates it **before** `buildManifest`; `vault-repo.put` uses the
pre-set id as-is. A failed sign/build burns an id number — sequence gaps are
expected.

### `VERIFY_DETAILS` (`verifier.js`) — Role C renders these verbatim

```js
SCREENSHOT_MISMATCH: "screenshot hash mismatch"
METADATA_MISMATCH:   "metadata hash mismatch"
MANIFEST_MISMATCH:   "manifest hash mismatch"
SIGNATURE_INVALID:   "signature invalid"
DECRYPTION_FAILED:   "decryption failed"
KEY_MALFORMED:       "public key malformed"
RECORD_NOT_FOUND:    "record not found"
```

`status` is `VERIFIED` (all four checks pass), `MODIFIED` (a comparison failed),
or `ERROR` (a check could not be evaluated). `details` is `[]` only on `VERIFIED`.

---

## 4. Contract deviations to reconcile with Role A

| # | Issue | Proposed resolution | Status |
|---|---|---|---|
| A | `service-worker.js` catch block emits `provider: "unknown"`; §5.2 says `"demo" \| "vision"`. This value is hashed into `metadata_hash`. | Failed path emits the attempted provider id (or `"vision"`), `status: "failed"`. `manifest-builder` passes the value through unchanged either way. | **Open — needs Role A** |
| B | Building Plan §5.6 / `shared/messages.js` `PRESERVE_STAGES` list is `capture, extract, hash, sign, timestamp, encrypt, store`. The IV must be inside the signed manifest, so the real order is `hash, encrypt, sign, timestamp, store`. | Edit `PRESERVE_STAGES` and the popup checklist labels to `capture, extract, hash, encrypt, sign, timestamp, store`. | **Open — needs Role A** |
| C | `tests/fixtures/capture.sample.json` / `extraction.ok.sample.json` were written by Role B from Role A's output shapes. | Role A to confirm field-for-field against current `capture.js` / `schema.js`. Re-checked at step 06 — still matches. | **Low risk — confirm** |
| D | `shared/types.js` is shared-ownership (Building Plan §6) but was authored solo by Role B in step 00. It only transcribes the frozen §5.1–§5.5 typedefs. | Role A + Role C review and approve. | **Open — needs review** |

---

## 5. Proposed `service-worker.js` wiring (PR — not yet applied)

Role A owns `background/service-worker.js`. This is the diff to pair-review; it is
**not** committed on this branch.

```diff
 import { captureVisibleTab } from "../capture/capture.js";
 import { getProvider, getSelectedProviderId } from "../extraction/provider.js";
 import { MSG } from "../shared/messages.js";
+import { lockEvidence } from "../evidence/index.js";
+import { verifyEvidence } from "../evidence/index.js";
+import * as vaultRepo from "../storage/vault-repo.js";

   if (message && message.type === MSG.PRESERVE_START) {
     (async () => {
       try {
         const captureResult = await captureVisibleTab();
         let extractionResult = null;
         try {
           /* ...existing extraction... */
         } catch (extError) {
           extractionResult = { provider: "vision", model: null,
             extractedAt: new Date().toISOString(), data: null,
             status: "failed", error: extError.message || "..." };
         }

-        sendResponse({ ok: true, message: "...", capture: captureResult, extraction: extractionResult });
+        const emit = (stage) =>
+          chrome.runtime.sendMessage({ type: MSG.PRESERVE_PROGRESS, payload: { stage, ok: true } })
+            .catch(() => {});
+        try {
+          const record = await lockEvidence({ capture: captureResult, extraction: extractionResult, emit });
+          sendResponse({ ok: true, evidence_id: record.evidence_id });
+        } catch (lockError) {
+          // Role A owns this fallback: surface a readable error; the capture is lost only if
+          // even a minimal preservation cannot be written.
+          sendResponse({ ok: false, error: lockError.message || "Preservation failed after capture" });
+        }
       } catch (error) {
         sendResponse({ ok: false, error: error.message || "Failed to capture screenshot" });
       }
     })();
     return true;
   }
+
+  if (message?.type === MSG.LIST_EVIDENCE) {
+    vaultRepo.list(message.payload || {}).then(
+      (items) => sendResponse({ ok: true, items }),
+      (err) => sendResponse({ ok: false, error: err.message }));
+    return true;
+  }
+  if (message?.type === MSG.GET_EVIDENCE) {
+    (async () => {
+      const record = await vaultRepo.get(message.payload.evidence_id);
+      if (!record) return sendResponse({ ok: false, error: "not found" });
+      const blob = await vaultRepo.getDecryptedScreenshot(message.payload.evidence_id);
+      sendResponse({ ok: true, manifest: record.manifest, screenshotObjectUrl: URL.createObjectURL(blob) });
+    })().catch((err) => sendResponse({ ok: false, error: err.message }));
+    return true;
+  }
+  if (message?.type === MSG.VERIFY_EVIDENCE) {
+    verifyEvidence(message.payload.evidence_id).then(
+      (result) => sendResponse({ ok: true, result }),
+      (err) => sendResponse({ ok: false, error: err.message }));
+    return true;
+  }
```

`lockEvidence` performs the vault write itself — the worker never calls
`vaultRepo.put`.

---

## 6. Definition of Done (Role B.md §7)

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | `canonicalize` deterministic across key order, unicode, restart | `tests/evidence/canonicalize.test.js` — 50 tests, incl. 10-permutation, emoji/RTL byte-stability, `vi.resetModules()` | **PASS** |
| 2 | Three hashes in the frozen order; screenshot hashed pre-encryption from decoded bytes | `manifest-builder.test.js` "hashing order" + `lock-evidence.test.js` "hashes the screenshot from decoded bytes, pre-encryption" | **PASS** |
| 3 | One signing keypair, non-extractable, public key in every manifest | `sign.test.js` "keeps the private key non-extractable" + `lock-evidence.test.js` §5.3 shape check asserts `signature.public_key_jwk` | **PASS** |
| 4 | Every record AES-GCM encrypted, unique IV in the manifest | `encrypt.test.js` "IV uniqueness" (25 distinct) + `lock-evidence.test.js` "different IV and manifest_hash on every run" | **PASS** |
| 5 | `lockEvidence` single atomic call; success writes one record, failure none | `lock-evidence.test.js` "writes nothing when a downstream step throws" / "...when signing fails after the id was allocated" — `count()` stays 0 | **PASS** |
| 6 | `verifyEvidence` → `VERIFIED` 100/100 on untouched records | `verifier.test.js` "verifies 100 times out of 100" | **PASS** |
| 7 | Every tamper-matrix entry → `MODIFIED`/`ERROR` with correct `details` | `verifier.test.js` rows 1–10 + structural-breakage + compound-failure | **PASS** |
| 8 | Exported package verifies using only the manifest's embedded public key, empty vault | `verifier.test.js` "verifies from the manifest and screenshot bytes alone" (calls `resetVault()` first) | **PASS** |
| 9 | Device time vs trusted-timestamp status separate; nothing calls device time "trusted" | `timestamp.test.js` source-scan test + `grep -rin "trusted" extension/src` — only field names / the separation rule itself | **PASS** |
| 10 | `list()` renders a 50-record vault without loading a screenshot | `vault-repo.test.js` "renders a 50-record vault as a small result" — asserts no returned item holds an `ArrayBuffer` | **PASS** |

**Known limitation (item 10):** IndexedDB has no column projection, so `list()`'s
cursor still deserialises each record transiently — peak memory is one record,
not the whole vault. A dedicated metadata store would remove even that. Out of
scope for the MVP; tracked here.

---

## 7. Outstanding

- Push `feat/role-b/test-foundation` and open the PR (held per instruction).
- Apply the §5 `service-worker.js` diff with Role A (pair-work, Building Plan §7).
- Land deviations A, B, D above.
