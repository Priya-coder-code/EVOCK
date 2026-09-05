# EVOCK — Building Plan

**Document type:** Technical build plan
**Applies to:** EVOCK MVP (Chromium extension prototype)
**Team size:** 3
**Status:** Roles not yet assigned. This document defines *what* gets built and *how*. The three `Role A/B/C` documents define *who owns which slice*.

---

## 0. How to read this document

This plan is written so that three people can build EVOCK **in parallel, from the start, without blocking each other**.

That is only possible if we agree on two things before writing code:

1. **The pipeline is modular.** Capture → Extract → Build Manifest → Lock (hash/sign/encrypt) → Store → Verify → Export. Each stage is a separate module with a fixed input and output.
2. **The contracts between stages are frozen early.** If Person 1 knows exactly what object comes out of `capture()`, they can build the extraction layer against a fake object immediately — before capture is even finished.

Section 5 (Module Contracts) is the most important section in this document. **Freeze it first, together, before splitting work.**

---

## 1. What we are actually building

A Chromium Manifest V3 browser extension that does this, end to end:

```text
User is on a page with abusive content
        ↓
Clicks EVOCK → [ PRESERVE EVIDENCE ]
        ↓
Consent screen → [ ANALYZE & PRESERVE ] or [ PRESERVE WITHOUT AI ]
        ↓
Real screenshot of the visible tab
        ↓
(optional) Vision-language model extracts visible info → structured JSON
        ↓
Evidence Manifest (screenshot ref + derived metadata + capture context)
        ↓
Canonicalize → SHA-256 (dual hash) → ECDSA P-256 signature → device timestamp
        ↓
AES-GCM 256 encryption of the screenshot
        ↓
IndexedDB local vault
        ↓
Vault UI + chronological timeline
        ↓
Verify (recompute hashes + check signature) → ✓ VERIFIED / ❌ MODIFIED
        ↓
Export → PDF report (human) + ZIP package (machine)
```

Two hard architectural rules that everyone must respect, everywhere in the codebase:

- **Rule 1 — The screenshot is the original artifact.** AI output is *derived metadata*. Never overwrite, never substitute, never "clean up" the screenshot based on the AI result.
- **Rule 2 — Preservation must never depend on AI.** If OpenRouter is down, rate-limited, or the user declines consent, `PRESERVE WITHOUT AI` must still produce a fully hashed, signed, encrypted, stored, verifiable evidence record. AI failure is a degraded field, not a failed capture.

---

## 2. Repository structure

We build a single repo with clear module boundaries so three people rarely touch the same file.

```text
EVOCK/
├── extension/
│   ├── manifest.json                 # MV3 manifest
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.js     # orchestrator: owns the preserve pipeline
│   │   ├── popup/
│   │   │   ├── popup.html
│   │   │   ├── popup.js              # Preserve / consent / result screens
│   │   │   └── popup.css
│   │   ├── vault/
│   │   │   ├── vault.html            # full-page vault + timeline + verify + export
│   │   │   └── vault.js
│   │   ├── capture/
│   │   │   └── capture.js            # chrome.tabs.captureVisibleTab wrapper
│   │   ├── extraction/
│   │   │   ├── provider.js           # ExtractionProvider interface + selector
│   │   │   ├── demo-provider.js      # deterministic offline provider
│   │   │   ├── vision-provider.js    # OpenRouter VLM provider
│   │   │   ├── prompt.js             # constrained extraction prompt
│   │   │   └── schema.js             # JSON schema + validator/normaliser
│   │   ├── evidence/
│   │   │   ├── canonicalize.js       # deterministic JSON serialisation
│   │   │   └── manifest-builder.js   # builds the Evidence Manifest v1.0
│   │   ├── crypto/
│   │   │   ├── hash.js               # SHA-256 helpers
│   │   │   ├── keystore.js           # ECDSA keypair generate/persist/export
│   │   │   ├── sign.js               # sign / verify manifest
│   │   │   └── encrypt.js            # AES-GCM encrypt / decrypt
│   │   ├── storage/
│   │   │   ├── db.js                 # IndexedDB open/upgrade/schema
│   │   │   └── vault-repo.js         # put/get/list/update evidence records
│   │   ├── verify/
│   │   │   └── verifier.js           # recompute + compare + signature check
│   │   ├── export/
│   │   │   ├── pdf-report.js         # jsPDF human-readable report
│   │   │   └── package-zip.js        # JSZip machine-readable package
│   │   └── shared/
│   │       ├── types.js              # JSDoc typedefs for every contract
│   │       ├── messages.js           # message-type constants (popup ↔ worker)
│   │       ├── ids.js                # evidence ID generator (NK-0001…)
│   │       └── log.js                # namespaced logging
├── bridge/
│   ├── server.js                     # local Node proxy that holds the API key
│   └── .env.example
├── demo/
│   └── chat.html                     # fake chat page for demos/screenshots
├── tests/
├── docs/
│   ├── EVOCK.md
│   ├── Building Plan.md
│   ├── Role A.md
│   ├── Role B.md
│   └── Role C.md
├── vite.config.js
└── package.json
```

---

## 3. Technology stack — every tool, and *why*

### 3.1 Platform

| Tool | Why we use it |
|---|---|
| **Chromium Manifest V3 extension** | EVOCK must capture *what the user is actually seeing in the browser*. Only an extension has `chrome.tabs.captureVisibleTab()`. A normal web app cannot screenshot another site's tab. MV3 is also the only manifest version Chrome still accepts for new extensions. |
| **Vanilla JavaScript (ES modules)** | The whole app is small, browser-native, and crypto-heavy. Adding React/Vue buys us component ergonomics we do not need and costs us bundle complexity inside a service worker. ES modules keep the module boundaries (which are the basis of our 3-way split) explicit. |
| **Vite** | Dev server + bundler. We need it because MV3 service workers and content scripts must be bundled into flat files, and because we want fast rebuilds while three people iterate. Vite gives near-instant HMR for the popup/vault pages and a simple multi-entry build for the extension. |
| **`@crxjs/vite-plugin`** (or a hand-rolled static-copy config) | Handles MV3 specifics: rewriting `manifest.json` paths, bundling the service worker as a module, and reloading the extension on change. Without it we would manually rebuild + "Reload extension" on every edit. If it causes friction, fall back to `vite-plugin-static-copy` + multi-entry `rollupOptions`. |

### 3.2 Capture

| Tool | Why |
|---|---|
| **`chrome.tabs.captureVisibleTab()`** | Produces a real PNG/JPEG of the visible viewport — the exact pixels the victim saw. This is our original artifact. Requires the `activeTab` permission, which is granted only on explicit user action — which matches our consent-first design. |
| **`chrome.scripting` / content script** (minimal) | Only to read page context (title, visible URL) and to support future scroll-stitched capture. We deliberately **do not** use DOM scraping as the extraction path (see §3.3). |
| **`chrome.storage.local`** | Small config only: consent state, selected provider, bridge URL, extension settings. Not for evidence. |

### 3.3 AI extraction

| Tool | Why |
|---|---|
| **Vision-Language Model (VLM)** | The refined architecture reads the *screenshot*, not the DOM. DOM structure changes without warning on WhatsApp/Instagram/X and breaks selectors; pixels do not. A VLM makes the extraction layer platform-agnostic. |
| **OpenRouter API** | Single HTTP endpoint that fronts many vision models (Claude, GPT, Gemini, Llama-vision, plus free-tier models). If one model is rate-limited or deprecated, we change one string instead of rewriting an integration. Also gives us cost visibility during the prototype. |
| **Structured JSON output + our own validator** | Model output must be machine-usable and hashable. We ask for strict JSON, then validate and normalise it ourselves. We never hash raw model prose. Unreadable fields must come back `null`, never guessed. |
| **Local Node bridge (`bridge/server.js`, Express or bare `node:http`)** | **Security requirement.** An API key shipped inside extension code is public — anyone can unzip a `.crx`. The bridge keeps the key in a `.env` on the developer machine; the extension calls `http://localhost:8787/extract`. This is the prototype answer to §25.4 of the spec. |
| **`dotenv`** | Loads the API key from `.env` (git-ignored) into the bridge process. |
| **`DemoExtractionProvider`** | A deterministic, offline provider returning a fixed structured result. Essential for (a) recorded demos that must not fail live, (b) reproducible tests, (c) working on a train with no internet. |

### 3.4 Cryptography

| Tool | Why |
|---|---|
| **Web Crypto API (`crypto.subtle`)** | Native, audited, constant-time-ish browser primitives. We must never hand-roll crypto. Available in both the service worker and extension pages. |
| **SHA-256** | Integrity fingerprint. Cheap, universally recognised, and its property is exactly what we claim: *if the artifact changes, the fingerprint changes*. It proves nothing about truth — the UI copy must say so. |
| **Dual hashing (screenshot hash + metadata hash → manifest hash)** | Lets us tell *what* changed. If only the metadata hash breaks, the AI text was altered; if the screenshot hash breaks, the image was altered. A single blob hash cannot distinguish these. |
| **Deterministic canonicalisation (RFC 8785-style JCS, hand-implemented)** | `JSON.stringify` key order is insertion-order dependent. Two logically identical manifests would otherwise hash differently and produce false "MODIFICATION DETECTED". We sort keys recursively, use a fixed number format, and hash UTF-8 bytes. This is a small function with outsized importance — it gets its own unit tests. |
| **ECDSA P-256 (`ECDSA` + `SHA-256` in Web Crypto)** | Digital signature over the manifest hash. Widely supported, small keys, natively available. Proves the record was signed by the holder of this vault's private key and has not been edited since. |
| **Non-extractable private key + `chrome.storage` / IndexedDB `CryptoKey` persistence** | We generate the signing keypair once and store the `CryptoKey` object itself in IndexedDB (structured-clone supports `CryptoKey`), with the private key marked non-extractable. The public key is exported as JWK/SPKI and embedded in every manifest so any third party can verify. |
| **AES-GCM, 256-bit** | Authenticated encryption for the screenshot at rest in the vault. GCM gives us confidentiality *and* tamper detection on the ciphertext itself. Random 96-bit IV per record, never reused. |
| **PBKDF2 (or the generated-key path) for the vault key** | For the MVP the AES key is generated and stored as a non-extractable `CryptoKey`. If we add a passphrase-locked vault, PBKDF2-SHA-256 with a high iteration count derives the key from the user's passphrase — no plaintext key on disk. |

### 3.5 Storage

| Tool | Why |
|---|---|
| **IndexedDB** | The only browser store that holds large binary `Blob`/`ArrayBuffer` data with a real query surface, and it survives restarts. `chrome.storage.local` has quota and shape limits that make it wrong for encrypted screenshots. |
| **`idb` (Jake Archibald's tiny promise wrapper)** — optional | Raw IndexedDB is callback-heavy and error-prone. `idb` is ~1KB and makes the repository layer readable. If we want zero dependencies here, we hand-write a small promise wrapper instead — the decision belongs to the storage owner. |

### 3.6 Export

| Tool | Why |
|---|---|
| **jsPDF** | Generates the human-readable report entirely client-side. No server, no data leaving the device. Good enough for text + embedded screenshot + hash blocks. |
| **JSZip** | Builds the machine-readable package (`manifest.json`, `screenshot.enc`, `signature.sig`, `verification.json`, `public-key.jwk`) in-browser as a downloadable ZIP. Investigators can re-verify offline. |
| **`chrome.downloads`** | Saves the generated PDF/ZIP to disk with a proper filename. |

### 3.7 Timestamping

| Tool | Why |
|---|---|
| **Device capture timestamp (ISO-8601 with offset)** | Always recorded, always labelled as *device time*. |
| **RFC 3161 timestamp abstraction (`TimestampProvider` interface)** | We build the *interface* now with a `not_configured` implementation, so a real TSA can be plugged in later without touching the manifest schema. **The UI must never call device time a "trusted timestamp".** |

### 3.8 Tooling / quality

| Tool | Why |
|---|---|
| **Vitest** | Test runner that shares Vite's config and transform pipeline — no separate build for tests. Crypto, canonicalisation, and verification logic are pure functions and *must* be unit-tested; a silent hash bug would destroy the product's only real claim. |
| **`@vitest/web-worker` / jsdom + Node 20 `crypto.subtle`** | Lets us run Web Crypto tests headlessly in Node without a browser. |
| **ESLint + Prettier** | Three people, one style. Prevents diff noise from formatting fights. |
| **Git + feature branches + PRs** | `main` stays runnable. Each role works on `feat/<area>/<thing>` and merges via PR with at least one reviewer from another role. |
| **`.env` + `.gitignore`** | The OpenRouter key never enters git history. Non-negotiable. |

### 3.9 Explicitly deferred (build the seam, not the feature)

TLSNotary web provenance, OCR fallback, on-device VLM, encrypted cloud backup, mobile. Each of these should have a clear place to plug in (a provider interface), but **no implementation work in the MVP**.

---

## 4. Build phases and milestones

Phases are ordered by dependency. The *order* is what matters.

| Phase | Goal | Definition of done |
|---|---|---|
| **P0 — Foundation** | Repo, Vite build, MV3 loads in Chrome, contracts frozen, ESLint/Vitest running | `npm run build` produces a loadable unpacked extension; `docs` contracts agreed by all 3; `shared/types.js` committed |
| **P1 — Vertical slice** | Capture a real screenshot → hash it → store it → show it in the vault. **No AI, no signing, no encryption yet.** | Clicking Preserve on any page stores a record you can reopen and see |
| **P2 — Parallel depth** | Extraction layer, full crypto lock, vault/timeline UI all built against the frozen contracts | Each module passes its own unit tests in isolation |
| **P3 — Integration** | Wire the three slices together through the service worker orchestrator | Full pipeline works with both `ANALYZE & PRESERVE` and `PRESERVE WITHOUT AI` |
| **P4 — Verify + Export** | Verification screen, tamper demo, PDF report, ZIP package | The tamper demo (§18 of spec) reproducibly flips ✓ → ❌ and back |
| **P5 — Hardening + demo** | Error states, empty states, consent copy review, limitations copy, demo script, README | A stranger can install it and complete a preservation without guidance |

**The P1 vertical slice is the highest-value milestone.** Get one boring end-to-end path working before anyone builds depth. It de-risks integration and gives every role a real object to develop against.

---

## 5. Module contracts (FREEZE THESE FIRST)

These live in `extension/src/shared/types.js` as JSDoc typedefs. Nobody changes them alone — a change is a group decision and a PR that all three approve.

### 5.1 CaptureResult — output of `capture/capture.js`

```js
/**
 * @typedef {Object} CaptureResult
 * @property {string}  screenshotDataUrl  // "data:image/png;base64,..."
 * @property {string}  mimeType           // "image/png"
 * @property {number}  width
 * @property {number}  height
 * @property {string}  url                // full URL of the captured tab
 * @property {string}  domain             // hostname only
 * @property {string}  tabTitle
 * @property {string}  capturedAt         // ISO-8601 with offset, device clock
 * @property {string}  captureMethod      // "browser_extension.captureVisibleTab"
 */
```

### 5.2 ExtractionResult — output of any `ExtractionProvider`

```js
/**
 * @typedef {Object} ExtractedMessage
 * @property {string|null} sender
 * @property {string|null} text
 * @property {string|null} visible_timestamp
 * @property {"incoming"|"outgoing"|null} type
 *
 * @typedef {Object} ExtractedData
 * @property {string|null} platform
 * @property {string|null} contact_name
 * @property {ExtractedMessage[]} messages
 * @property {string|null} visible_time
 * @property {string|null} date
 *
 * @typedef {Object} ExtractionResult
 * @property {"demo"|"vision"|"none"} provider
 * @property {string|null} model              // e.g. "openrouter/<model-id>"
 * @property {string|null} extractedAt        // ISO-8601
 * @property {ExtractedData|null} data        // null when provider === "none"
 * @property {"ok"|"failed"|"skipped"} status
 * @property {string|null} error              // human-readable failure reason
 */
```

> `status: "skipped"` is what `PRESERVE WITHOUT AI` produces. `status: "failed"` is what an API error produces. **Both still result in a complete, locked evidence record.**

### 5.3 EvidenceManifest v1.0 — the thing that gets hashed and signed

```json
{
  "schema_version": "1.0",
  "evidence_id": "NK-0001",
  "source": {
    "capture_method": "browser_extension.captureVisibleTab",
    "url": "https://web.whatsapp.com/...",
    "domain": "web.whatsapp.com",
    "tab_title": "WhatsApp"
  },
  "capture": {
    "device_captured_at": "2026-09-01T23:31:14+05:30",
    "screenshot_width": 1440,
    "screenshot_height": 900,
    "mime_type": "image/png"
  },
  "visual_artifact": {
    "type": "screenshot",
    "storage": "encrypted",
    "encryption": { "algorithm": "AES-GCM", "key_length": 256, "iv": "<base64>" }
  },
  "ai_derived_metadata": {
    "provider": "vision",
    "model": "<model-id>",
    "status": "ok",
    "extracted_at": "2026-09-01T23:31:19+05:30",
    "data": { "platform": "WhatsApp", "contact_name": "Mr. ABC B", "messages": [], "visible_time": "11:28 PM", "date": "1 September 2026" }
  },
  "integrity": {
    "hash_algorithm": "SHA-256",
    "screenshot_hash": "<hex>",
    "metadata_hash": "<hex>",
    "manifest_hash": "<hex>"
  },
  "signature": {
    "algorithm": "ECDSA-P256-SHA256",
    "public_key_jwk": { },
    "signature": "<base64>",
    "signed_at": "2026-09-01T23:31:20+05:30"
  },
  "timestamp": {
    "device_capture_time": "2026-09-01T23:31:14+05:30",
    "trusted_timestamp_status": "not_configured",
    "trusted_timestamp_token": null
  }
}
```

**Hashing order (must be implemented exactly):**

```text
screenshot_hash = SHA256( raw screenshot bytes, pre-encryption )
metadata_hash   = SHA256( canonicalize( ai_derived_metadata ) )
manifest_hash   = SHA256( canonicalize( manifest without .integrity.manifest_hash and without .signature ) )
signature       = ECDSA-P256-SHA256( manifest_hash bytes, privateKey )
```

The `signature` block and `manifest_hash` are excluded from their own input — otherwise the hash can never be reproduced. Write this down in a comment above the function.

### 5.4 StoredEvidenceRecord — what IndexedDB holds

```js
/**
 * @typedef {Object} StoredEvidenceRecord
 * @property {string} evidence_id            // primary key
 * @property {EvidenceManifest} manifest
 * @property {ArrayBuffer} screenshot_ciphertext
 * @property {ArrayBuffer} iv
 * @property {string} created_at             // index for timeline ordering
 * @property {string} platform_label         // index for grouping, may be "Unknown"
 * @property {VerificationResult|null} last_verification
 */
```

### 5.5 VerificationResult — output of `verify/verifier.js`

```js
/**
 * @typedef {Object} VerificationResult
 * @property {boolean} screenshot_hash_ok
 * @property {boolean} metadata_hash_ok
 * @property {boolean} manifest_hash_ok
 * @property {boolean} signature_ok
 * @property {"VERIFIED"|"MODIFIED"|"ERROR"} status
 * @property {string[]} details              // e.g. ["metadata_hash mismatch"]
 * @property {string} verified_at
 */
```

### 5.6 Message protocol — popup/vault ↔ service worker

All cross-context calls go through `chrome.runtime.sendMessage` with a `{ type, payload }` envelope. Types live in `shared/messages.js`:

```text
PRESERVE_START      { withAI: boolean }        → { evidence_id }
PRESERVE_PROGRESS   { stage, ok, error }       (worker → popup, streamed)
LIST_EVIDENCE       { }                        → StoredEvidenceRecord[] (no ciphertext)
GET_EVIDENCE        { evidence_id }            → { manifest, screenshotObjectUrl }
VERIFY_EVIDENCE     { evidence_id }            → VerificationResult
EXPORT_PDF          { evidence_id }            → { downloadId }
EXPORT_PACKAGE      { evidence_id }            → { downloadId }
TAMPER_DEMO         { evidence_id, mode }      → { ok }   // dev build only
```

`PRESERVE_PROGRESS` stages, in order: `capture`, `extract`, `hash`, `sign`, `timestamp`, `encrypt`, `store`. The popup renders these as a live checklist — this is both good UX and our best debugging tool.

---

## 6. How the work divides into three

The split follows the pipeline's natural seams. Each slice is roughly equal in difficulty and each contains at least one genuinely hard problem, so nobody gets only glue work.

```text
┌─────────────────────────────────────────────────────────────┐
│  ROLE A — CAPTURE & INTELLIGENCE                            │
│  Extension shell, MV3, service-worker orchestrator,         │
│  popup + consent flow, screenshot capture,                  │
│  extraction provider architecture, OpenRouter vision        │
│  integration, prompt design, JSON schema validation,        │
│  local Node bridge (API key security)                       │
└─────────────────────────────────────────────────────────────┘
                          ↓ CaptureResult + ExtractionResult
┌─────────────────────────────────────────────────────────────┐
│  ROLE B — EVIDENCE CORE (CRYPTO & VAULT)                    │
│  Canonicalisation, dual SHA-256 hashing, manifest builder,  │
│  ECDSA P-256 keystore + signing, AES-GCM encryption,        │
│  IndexedDB vault repository, verification engine,           │
│  timestamp abstraction, tamper-demo harness                 │
└─────────────────────────────────────────────────────────────┘
                          ↓ StoredEvidenceRecord + VerificationResult
┌─────────────────────────────────────────────────────────────┐
│  ROLE C — PRESENTATION, EXPORT & PLATFORM                   │
│  Vite/MV3 build pipeline, vault UI, incident timeline,      │
│  evidence detail view, human review/edit of AI metadata,    │
│  verification UI, jsPDF report, JSZip package,              │
│  demo page, test harness, docs, release/demo script         │
└─────────────────────────────────────────────────────────────┘
```

Detailed work plans, tool lists and rationale for each slice are in **`Role A.md`**, **`Role B.md`** and **`Role C.md`**.

### Shared ownership (everyone)

- `shared/types.js` — changes require all three to approve.
- Copy about what EVOCK can and cannot prove — review together (§36 of the spec).
- Code review — every PR needs one approval from a different role.

---

## 7. Integration plan

Parallel work only pays off if integration is planned, not improvised.

**Fixture-first.** Before splitting, commit `tests/fixtures/`:
- `capture.sample.json` — a real `CaptureResult` with a small base64 PNG
- `extraction.sample.json` — a valid `ExtractionResult`
- `manifest.sample.json` — a fully-populated `EvidenceManifest`
- `record.sample.json` — a `StoredEvidenceRecord`

Every role develops against these fixtures until the real upstream module lands. Role B can build and test the entire crypto layer before capture works. Role C can build the whole vault UI before there is anything in IndexedDB.

**Integration point 1 (end of P1):** Capture → Hash → Store → Display. Three people, one branch, one afternoon. Everything downstream is easier once this exists.

**Integration point 2 (P3):** The service worker orchestrator (Role A) calls Role B's `lockEvidence()` and Role C's export functions. This is a single file — `background/service-worker.js` — so it should be **pair-worked**, not merged blindly from three branches.

**Daily sync (15 min):** what merged, what is blocked, has any contract changed.

---

## 8. Risk register and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Hash mismatch caused by non-deterministic JSON | False "MODIFICATION DETECTED" — destroys the demo and the product claim | Canonicalisation is written first, unit-tested against key-order permutations, and used by *both* the hasher and the verifier through the same function |
| OpenRouter down / rate-limited / model deprecated | Live demo failure | `DemoExtractionProvider` + `PRESERVE WITHOUT AI` path + provider is a config string, not a hardcode |
| API key leaks into the repo | Real security incident | Key lives only in `bridge/.env`; `.env` in `.gitignore`; the extension never contains a key; add a pre-commit grep for `sk-` / `or-` prefixes |
| MV3 service worker terminates mid-pipeline | Half-written evidence records | Keep the pipeline short; persist the record only once, atomically, at the end; if a long AI call is needed, hold state in `chrome.storage.session` and resume |
| `CryptoKey` lost → all past evidence unverifiable | Catastrophic for the user | Export the public key into every manifest so verification never needs the vault; offer a key-backup export in the vault UI |
| Three people editing `service-worker.js` | Merge hell | One owner (Role A) for that file; others send PRs against it |
| Scope creep into TLSNotary / OCR / on-device VLM | MVP never ships | These are interfaces only. No implementation before P5 is done |
| Over-claiming in the UI ("court-admissible", "everything is local") | Reputational and ethical problem, contradicts §36 of the spec | A copy review pass in P5 where all three read every user-facing string against the "never claim" list |

---

## 9. Definition of done for the MVP

The build is complete when a person who has never seen the code can:

1. Load the unpacked extension into Chrome.
2. Open any page, click EVOCK, and see a consent screen that honestly states the screenshot will be sent for analysis.
3. Choose **ANALYZE & PRESERVE** and get a record with structured metadata — or choose **PRESERVE WITHOUT AI** and get an equally complete, equally locked record.
4. Open the vault and see the incident in a chronological timeline.
5. Open one record and see the screenshot, the derived metadata (clearly labelled as derived), the hashes, the signature status, and the timestamp status (honestly labelled `device time`).
6. Click **Verify** and see ✓ INTEGRITY VERIFIED.
7. Run the tamper demo, click Verify again, and see ❌ MODIFICATION DETECTED with the specific field that changed.
8. Restore, verify again, and see ✓ again.
9. Export a PDF report and a ZIP package, and open both outside the browser.
10. Read a Limitations section in the UI that accurately states what EVOCK cannot establish.

If all ten hold with the AI service switched off, the architecture is correct.
