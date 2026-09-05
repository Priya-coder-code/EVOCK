# Role C — Presentation, Export & Platform

**Slice:** The back half of the pipeline plus the ground everything stands on — the build system, everything the user actually looks at, and everything that leaves the vault.
**Owns:** the Vite/MV3 build pipeline, the vault UI, the incident timeline, the evidence detail view, the human review/edit flow for AI metadata, the verification UI, the jsPDF report, the JSZip package, the demo page, the test harness, and the project docs.
**Consumes:** `StoredEvidenceRecord` and `VerificationResult` from Role B; renders `ExtractionResult` states from Role A.
**Depends on:** nothing at runtime — you build against `tests/fixtures/` from the start.

> Read `Building Plan.md` §5.4–§5.6 before writing code. You render other people's data structures; if you find yourself wanting to reshape one, that is a contract conversation, not a local fix.

---

## 1. Why this slice exists

Two reasons, and both are load-bearing.

**First, the build.** Three people cannot work in parallel on an MV3 extension until `npm run build` reliably produces something Chrome will load. This is foundational work that unblocks everyone else, which is why it sits in this role rather than being nobody's job.

**Second, the honesty layer.** EVOCK's technical claims are narrow and precise: it can show that bytes did not change since preservation. It cannot show that a conversation is true, that an account belongs to a person, or that a court will accept the package. **Every one of those distinctions is communicated through UI text that this role writes.** A perfect cryptographic core behind a UI that says "court-admissible proof" is a worse product than no product. The copy is engineering work here, not decoration.

You are also the person who sees the whole pipeline from the outside, which makes you the natural owner of integration testing and the demo script.

---

## 2. Files you own

```text
vite.config.js
package.json
.eslintrc / .prettierrc
extension/src/vault/vault.html
extension/src/vault/vault.js
extension/src/vault/vault.css
extension/src/vault/components/*        (timeline, record-card, detail-panel, verify-panel, review-editor)
extension/src/export/pdf-report.js
extension/src/export/package-zip.js
demo/chat.html
tests/fixtures/*
tests/integration/*
README.md  (build + run instructions)
docs/demo-script.md
```

Role A owns the popup; you own the full-page vault. Where the two share visual language (buttons, status pills, the ✓/❌ treatment), put it in `vault.css` and have the popup import it, so the two surfaces cannot drift.

---

## 3. Work plan

### C1 — Build pipeline (P0 — everyone is blocked until this lands)

Get `npm run build` producing a loadable unpacked extension, and `npm run dev` giving fast rebuilds.

- **Vite** with multiple entries: the service worker, the popup page, and the vault page. The service worker must be bundled as an ES module (`"type": "module"` in the manifest) and must not be code-split — MV3 workers cannot load dynamic chunks reliably.
- **`@crxjs/vite-plugin`** if it behaves: it rewrites `manifest.json` paths, handles the worker, and reloads the extension on change. If it fights the MV3 version we target, fall back to `vite-plugin-static-copy` plus explicit `rollupOptions.input` entries — a slightly worse dev loop but far fewer surprises. Decide this early and tell the team; do not leave it ambiguous.
- **ESLint + Prettier** with one shared config, and a `npm run lint` that CI-or-conscience runs before merge. Three people, one style, zero formatting diffs.
- **Vitest** configured to share the Vite transform, with Node 20 so `crypto.subtle` is available for Role B's tests.
- Output to `dist/`; document "Load unpacked → select `dist/`" in the README.

**Done when:** all three team members can clone, `npm i && npm run build`, and load the extension in under two minutes.

### C2 — Fixtures (P0)

Commit `tests/fixtures/` before anyone splits off:

```text
capture.sample.json      // real CaptureResult with a small base64 PNG
extraction.ok.json       // status: "ok" with 2 messages
extraction.failed.json   // status: "failed" with an error string
extraction.skipped.json  // status: "skipped", data: null
manifest.sample.json     // fully populated EvidenceManifest v1.0
record.sample.json       // StoredEvidenceRecord
verification.ok.json
verification.modified.json
```

These are the contract made concrete. Role B builds crypto against them; you build the entire vault UI against them; nobody waits for anybody.

### C3 — Vault shell and timeline (P2)

A full extension page (`chrome-extension://<id>/src/vault/vault.html`), opened from the popup.

**List view** — grouped chronologically, which is the product's stated differentiator (spec §17):

```text
EVIDENCE VAULT                       12 records

14 Aug 2026
  NK-0003  WhatsApp    Mr. ABC B      ✓ Verified
  NK-0004  Instagram   @example       ✓ Verified

13 Aug 2026
  NK-0002  WhatsApp    Mr. ABC B      ⚠ Not verified since 12 Aug
```

- Render from `vaultRepo.list()` — **metadata only, never screenshots**. Load an image only when a record is opened. A 50-record vault must not pull hundreds of MB into memory.
- Filters: platform, date range, verification status. Sort: newest/oldest.
- Empty state that explains what the vault is for, not a blank page.
- Neutral language throughout. "Repeated contact across 4 captured incidents" — **never** "confirmed stalker", never "threat level". The tool organises facts; it does not diagnose (spec §17).

**Detail view** — one record, everything about it:

```text
NK-0003                                    [ Verify ]  [ Export ▾ ]

ORIGINAL SCREENSHOT
[ image ]                                  ← decrypted on open, revoked on close

VISIBLE INFORMATION            ⓘ AI-derived — check against the screenshot
Platform      WhatsApp
Contact       Mr. ABC B
Messages      "Don't try to hide....."
              "I know where you live"
Visible time  11:28 PM
Date          1 September 2026

CAPTURE CONTEXT
URL           https://web.whatsapp.com/...
Device time   1 Sep 2026, 23:31:14 +05:30   ← labelled "device time", not "timestamp"

INTEGRITY
Screenshot hash   83a91f…      [copy]
Metadata hash     2c7e04…      [copy]
Manifest hash     b1d550…      [copy]
Signature         ✓ ECDSA P-256
Trusted timestamp  Not configured
Encryption        ✓ AES-GCM 256
```

Two UI rules you enforce here:

1. The **AI-derived block is visually distinct** — a tinted panel, a persistent label, and an info affordance explaining that a vision model can misread names, timestamps and small text (spec §25.1). It must never look like ground truth sitting next to the screenshot.
2. **"Device time" is never rendered as "Trusted timestamp."** Two separate rows, honest labels, and `Not configured` shown plainly rather than hidden (spec §25.11).

Use `URL.createObjectURL` for the decrypted screenshot and **`URL.revokeObjectURL` when the panel closes** — otherwise decrypted evidence accumulates in memory for the session.

### C4 — Human review / edit of AI metadata (P3)

Spec §26.4. Before a record is locked, and again from the detail view, the user can correct what the model misread.

```text
AI extracted:
Contact:  Rahul Sharma     [ edit ]
Message:  "…"              [ edit ]

[ EDIT ]   [ ACCEPT & LOCK ]
```

The rule that makes this defensible: **an edit never overwrites a signed record.** Editing produces a new version — new metadata hash, new manifest hash, new signature — and the record retains its history:

```text
v1  AI-derived        1 Sep 2026 23:31   ✓ signed
v2  Human-corrected   2 Sep 2026 09:04   ✓ signed
```

Coordinate the versioned-record shape with Role B before building the UI; it touches their manifest schema. The correction is itself an evidenced event, not an erasure.

### C5 — Verification UI (P4)

Calls Role B's `verifyEvidence(id)` and renders `VerificationResult` — including the specific failure, not just a red X.

Success:
```text
✓ INTEGRITY VERIFIED
Screenshot ✓   Metadata ✓   Manifest ✓   Signature ✓
Verified 2 Sep 2026, 10:12
```

Failure:
```text
❌ MODIFICATION DETECTED

RECORDED HASH   83A91F…
CURRENT HASH    B72C19…

Screenshot ✓   Metadata ❌   Manifest ❌   Signature ❌
The AI-derived metadata does not match the record created on 1 Sep 2026.
```

Show the recorded-vs-current hash pair side by side. That contrast is the entire cryptographic argument made visible in two lines (spec §18) — it is the demo's payoff, and it deserves real design attention.

Add a small honest footer: verification shows that the stored record has not changed since preservation. It does not establish who sent the message or whether the conversation is truthful.

### C6 — Export (P4)

**Human-readable PDF (`jsPDF`)** — everything in spec §19, in this order: evidence ID, platform/source, contact, visible content, visible timestamp, device capture time, screenshot preview, all three SHA-256 hashes, signature status, timestamp status, verification result — and a **Limitations** section on the final page, drawn from spec §27, stating plainly what EVOCK cannot establish.

That limitations page is not boilerplate. If this PDF reaches a lawyer or an investigator, it must not overstate what it is. Write it, keep it, do not let it get trimmed for tidiness.

**Machine-readable ZIP (`JSZip`)**:

```text
NK-0003/
├── manifest.json        # EvidenceManifest v1.0, canonicalised
├── screenshot.enc       # AES-GCM ciphertext
├── signature.sig        # base64 ECDSA signature
├── public-key.jwk       # so anyone can verify without our vault
├── verification.json    # last VerificationResult
└── README.txt           # how to verify: which bytes, which algorithm, in what order
```

`README.txt` is what makes the package genuinely useful — an investigator with Python and no EVOCK install should be able to reproduce the hashes and check the signature from that file alone. Write the exact hashing order from `Building Plan.md` §5.3 into it.

Save both via `chrome.downloads` with predictable filenames (`EVOCK-NK-0003-report.pdf`, `EVOCK-NK-0003-package.zip`).

### C7 — Demo page (P1 — small but do it early)

`demo/chat.html` — a static fake chat resembling a messaging app, with the sample content from the spec. Needed because:
- capturing real WhatsApp during development means handling real personal data unnecessarily;
- it gives everyone a stable, reproducible screenshot for tests;
- it lets the recorded demo be identical every run.

Keep it obviously fictional. Do not clone a real product's branding.

### C8 — Integration tests and demo script (P5)

- `tests/integration/` — the full path against fixtures: build manifest → lock → store → list → verify → export. Assert the PDF and ZIP are produced and non-trivially sized; assert the ZIP contains all six entries.
- **Copy review pass:** read every user-facing string in the popup, the vault, the PDF, and the README against spec §36's "never claim" list. Anything matching "court-admissible", "proves", "everything is local", "recovers deleted messages", "identifies the sender" gets rewritten. Run this with all three of you in the room — it is a 30-minute pass that protects the whole project.
- `docs/demo-script.md` — a timed walkthrough: capture on the demo page → consent → result → vault → detail → verify ✓ → tamper → verify ❌ → restore → verify ✓ → export PDF. Include a rehearsed fallback where the AI provider is switched to `demo` so a dead network cannot break the presentation.
- README: install, build, load unpacked, start the bridge, configure the key, run tests.

---

## 4. Tools you use, and why

| Tool | What you use it for | Why this one |
|---|---|---|
| **Vite** | Dev server and bundler | MV3 needs flat bundled outputs for the worker and pages; Vite gives that plus fast rebuilds while three people iterate. Multi-entry config maps cleanly onto popup / vault / worker |
| **`@crxjs/vite-plugin`** | MV3-aware building | Handles manifest path rewriting, module workers, and extension reload. Falls back to `vite-plugin-static-copy` + explicit rollup inputs if it fights our MV3 target |
| **Vanilla JS + ES modules (no framework)** | Vault UI | The vault is a list, a detail panel, and a few state transitions. React would add a build dependency and bundle weight for ergonomics we do not need — and would blur the module boundaries our 3-way split depends on |
| **Plain CSS with custom properties** | Styling both surfaces | No Tailwind/CSS-in-JS build step to debug inside an extension. Custom properties give us one shared token set that popup and vault both import, so the two cannot drift |
| **`URL.createObjectURL` / `revokeObjectURL`** | Displaying decrypted screenshots | Renders a decrypted `Blob` without ever putting it back on disk; revoking on close means decrypted evidence does not accumulate in memory |
| **IndexedDB via Role B's `vaultRepo`** | All data access | You never touch IndexedDB directly. One module owns storage, which keeps transactions correct and keeps `list()` from loading blobs |
| **jsPDF** | Human-readable report | Generates the PDF entirely client-side — no server, no evidence leaving the device. Sufficient for text, tables, hash blocks and an embedded screenshot |
| **JSZip** | Machine-readable package | Builds the multi-file evidence package in-browser as a downloadable ZIP that an investigator can verify offline |
| **`chrome.downloads`** | Saving exports | Proper filenames and a real save dialog, rather than an anchor-click hack |
| **Vitest** | Unit + integration tests | Shares Vite's config and transforms, so there is no second build to maintain. Runs Role B's crypto tests headlessly on Node 20 |
| **`tests/fixtures/`** | Parallel development | Lets you build the entire vault, timeline, verification and export UI before a single real record exists. This is what makes the 3-way split actually parallel |
| **ESLint + Prettier** | Shared style | Removes formatting noise from three-way diffs; catches the class of bug that shows up as an unused import or an unhandled promise |
| **Static demo page (`demo/chat.html`)** | Reproducible capture target | Avoids handling real personal data in development and makes tests and the recorded demo deterministic |

---

## 5. Contracts you must not break

You **consume** `StoredEvidenceRecord` and `VerificationResult`, and you render all three `ExtractionResult.status` values.

- Render `ok`, `failed` and `skipped` as three genuinely different states. `skipped` is a legitimate, complete preservation — **do not style it as an error**. A user who chose `PRESERVE WITHOUT AI` should feel they did something normal, because they did.
- `VerificationResult.details[]` strings come from Role B. Agree the wording once; do not parse or rewrite them in the UI.
- If you need a new field to render something, ask for it in the daily sync. Do not derive it locally from data that also gets hashed — a display-only transform that leaks back into the manifest is a hash bug.

---

## 6. Testing your slice

- **Fixture rendering:** every UI state has a fixture — empty vault, one record, 50 records, `ok`/`failed`/`skipped` extraction, `VERIFIED`/`MODIFIED`/`ERROR` verification, a record with `null` platform and `null` contact. Every one of these must render without a crash and without a blank region.
- **Performance:** a 50-record vault list renders fast and does not decrypt anything. Assert `list()` returns no ciphertext fields.
- **Memory:** open and close 20 detail views; object URLs are revoked (check `chrome://` task manager or count live URLs in a test harness).
- **Export:** the PDF opens in a real PDF reader; the ZIP extracts on the command line; the ZIP's `manifest.json` byte-matches the canonicalised manifest in the vault.
- **Independent verification:** take an exported ZIP to a machine with an empty vault and confirm the hashes and signature check out using only `README.txt` as instructions. If that fails, the package is decorative.
- **Copy audit:** grep the whole `dist/` bundle for `admissib`, `proves`, `guarantee`, `locally`, `recover` and review every hit.

---

## 7. Definition of done

1. `npm i && npm run build` → loadable unpacked extension, first try, on all three machines.
2. Fixtures committed first and used by both other roles.
3. Vault lists records grouped chronologically without loading a single screenshot.
4. Detail view shows screenshot, derived metadata (visually distinct and labelled), capture context, all three hashes, signature, timestamp status and encryption status.
5. Human review/edit produces a new signed version and preserves the original — no silent overwrite.
6. Verification UI shows recorded-vs-current hashes side by side and names the specific field that changed.
7. PDF report contains every field in spec §19 plus an accurate Limitations section.
8. ZIP package contains all six entries and verifies independently on a clean machine.
9. Every user-facing string passes the §36 "never claim" audit — no "court-admissible", no "everything is local", no "recovers deleted messages".
10. `docs/demo-script.md` runs start to finish in under five minutes with the network switched off.
