# Role A — Capture & Intelligence

**Slice:** The front half of the pipeline — everything from "user clicks the extension" to "we have a `CaptureResult` and an `ExtractionResult`".
**Owns:** the extension shell, the MV3 service-worker orchestrator, the popup, screenshot capture, the extraction provider architecture, the vision integration, and the local API-key bridge.
**Hands off to:** Role B (evidence core) via `CaptureResult` + `ExtractionResult`.
**Depends on:** nothing upstream. This role can start immediately with zero blockers.

> Read `Building Plan.md` §5 before writing code. Your two output contracts (§5.1 and §5.2) are what the other two roles build against — get them committed first even if the implementations are stubs.

---

## 1. Why this slice exists

EVOCK's entire premise is *preserve it while it is still visible*. That means the capture path has to be fast, reliable, and honest — and it must never be the thing that fails.

This slice also owns the single hardest correctness question in the product: **the AI is allowed to be wrong, but it is never allowed to be load-bearing.** Every design decision here follows from that.

---

## 2. Files you own

```text
extension/manifest.json
extension/src/background/service-worker.js
extension/src/popup/popup.html
extension/src/popup/popup.js
extension/src/popup/popup.css
extension/src/capture/capture.js
extension/src/extraction/provider.js
extension/src/extraction/demo-provider.js
extension/src/extraction/vision-provider.js
extension/src/extraction/prompt.js
extension/src/extraction/schema.js
extension/src/shared/messages.js
bridge/server.js
bridge/.env.example
```

You are the **sole owner of `service-worker.js`**. Roles B and C send PRs against it rather than editing it directly — it is the one file where all three slices meet, and concurrent edits there cause the worst merge conflicts in the project.

---

## 3. Work plan

### A1 — Extension skeleton (P0)

Build the MV3 manifest and get an extension that loads in `chrome://extensions` with Developer Mode on.

```json
{
  "manifest_version": 3,
  "name": "EVOCK",
  "version": "0.1.0",
  "action": { "default_popup": "src/popup/popup.html" },
  "background": { "service_worker": "src/background/service-worker.js", "type": "module" },
  "permissions": ["activeTab", "scripting", "storage", "downloads", "unlimitedStorage"],
  "host_permissions": ["http://localhost:8787/*"]
}
```

Permission rationale — you should be able to defend each one:

| Permission | Why | Why not more |
|---|---|---|
| `activeTab` | Grants screenshot access to the current tab **only after the user clicks the extension**. | We deliberately avoid `<all_urls>` — a tool for abuse victims must not request permanent read access to every site they visit. |
| `scripting` | Injects a tiny context reader for tab title / visible URL, and leaves room for future scroll-stitched capture. | No persistent content script on every page. |
| `storage` | Settings only: provider choice, bridge URL. | Evidence never goes here — that is Role B's IndexedDB. |
| `downloads` | Saves the exported PDF/ZIP (used by Role C, declared here). | — |
| `unlimitedStorage` | Screenshots are large; a vault of 50 incidents will exceed the default IndexedDB quota. | — |
| `host_permissions: localhost:8787` | Lets the extension call the local bridge. | The extension never gets permission to call OpenRouter directly — that is the whole point of the bridge. |

**Done when:** the extension loads, the popup opens, and `console.log` from the service worker appears in the worker's inspector.

### A2 — Screenshot capture (P1)

`capture/capture.js` exports one function:

```js
/** @returns {Promise<CaptureResult>} */
export async function captureVisibleTab() { }
```

Implementation notes:

- `chrome.tabs.captureVisibleTab(windowId, { format: "png" })` returns a data URL. Use **PNG, not JPEG** — JPEG is lossy, and re-encoding an artifact we are about to hash and call "the original" is indefensible.
- Read width/height by decoding the data URL into an `ImageBitmap` (`createImageBitmap`) — do not trust `tab.width`, which is the window, not the captured image.
- Record `capturedAt` as an ISO-8601 string **with the UTC offset** (`new Date().toISOString()` gives UTC; you also want the local offset for the report). Store the offset explicitly.
- Handle the failure modes explicitly and surface them as readable errors, not silent nulls:
  - `chrome://` and Web Store pages cannot be captured — show "This page cannot be captured by browser extensions."
  - No `activeTab` grant → tell the user to click the extension icon rather than triggering from a context menu.
  - Capture quota (`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`) → retry once with a short backoff.

**Done when:** clicking Preserve produces a `CaptureResult` matching §5.1 exactly, logged to the worker console, on at least three real sites plus the local demo page.

### A3 — Popup (P1–P2)

**Preserving evidence is one click.** The user clicks `PRESERVE EVIDENCE` and the entire pipeline runs — capture, AI extraction, hash, sign, timestamp, encrypt, store — with no dialog, disclosure, or confirmation step anywhere in it. Evidence is time-sensitive; anything between the click and the capture is a window in which the content can be deleted.

Two screens in one popup, no router needed — just show/hide sections.

**Screen 1 — Ready**
```text
EVOCK
Current page: web.whatsapp.com

[ PRESERVE EVIDENCE ]

[ Open Vault ]   [ Settings ]
```

**Screen 2 — Progress + result.** Clicking Preserve goes straight here, with nothing in between. Render the `PRESERVE_PROGRESS` stages as a live checklist:

```text
✓ Screenshot captured
✓ Visible information extracted
✓ Fingerprint generated
✓ Signed
· Timestamp: device time only
✓ Encrypted
✓ Saved to vault

✓ EVIDENCE PRESERVED — NK-0004
[ View in Vault ]
```

When extraction fails, that line must read `⚠ AI extraction unavailable — screenshot preserved` in a **non-alarming** style, and the rest of the checklist must still complete. This is the visual proof of Rule 2.

**Settings** — a small panel, not a wizard:
- Vision provider / model
- Bridge URL + a health indicator

**Done when:** one click on `PRESERVE EVIDENCE` completes a full preservation with no intermediate screen of any kind, and killing the bridge mid-run produces the degraded-but-successful outcome.

### A4 — Extraction provider architecture (P2)

The interface comes before any provider:

```js
// extraction/provider.js
/**
 * @typedef {Object} ExtractionProvider
 * @property {string} id
 * @property {(capture: CaptureResult) => Promise<ExtractionResult>} extract
 */

export function getProvider(id) { /* "demo" | "vision" */ }
```

Build the providers in this order — **demo first**, deliberately:

1. **`demo-provider.js`** — returns a fixed, valid `ExtractionResult` after a ~600 ms simulated delay. This unblocks Roles B and C immediately and guarantees a demo that cannot fail on stage.
2. **`vision-provider.js`** — POSTs to the local bridge, not to OpenRouter.

The provider selector reads from `chrome.storage.local`, so switching providers is a settings change, not a code change.

### A5 — Prompt design and schema validation (P2)

This is the part that decides whether the AI output is usable or garbage.

`prompt.js` — a constrained extraction prompt. The requirements from the spec (§9):

- Extract **only what is visibly present**.
- Do not infer, guess, or complete partial text.
- Return `null` for any field that is not confidently readable.
- Do not characterise, judge, or classify the content (no "this is threatening", no "this is a stalker").
- Return **strict JSON only**, matching the given shape, no prose, no markdown fence.

Send the screenshot as a base64 image part in the OpenRouter chat-completions payload, and request JSON output (`response_format: { type: "json_object" }` where the model supports it).

`schema.js` — never trust the model's output shape. Validate and normalise:

- Parse defensively: strip markdown fences if the model adds them, `JSON.parse` in a `try/catch`.
- Enforce the `ExtractedData` shape: unknown keys dropped, missing keys set to `null`, `messages` coerced to an array.
- Type-check every field; a number where a string belongs becomes `null`, not a cast.
- Trim whitespace, but **never** correct spelling or "clean up" message text — that would alter evidence.
- Cap `messages` length (e.g. 50) so a hallucinating model cannot bloat the manifest.
- On any validation failure: return `status: "failed"` with a readable `error`. Never return partially-valid data silently.

Why we validate ourselves rather than trusting the model: the normalised object is about to be **canonicalised and hashed** by Role B. A field that is sometimes `""` and sometimes `null` produces different hashes for the same screenshot. Normalisation is a correctness requirement, not defensive politeness.

**Done when:** given 5 test screenshots (WhatsApp, Instagram DM, X, a website comment, and a deliberately blurry one), the validator returns well-formed `ExtractionResult`s and the blurry one returns `null`s rather than invented text.

### A6 — Local Node bridge (P2)

`bridge/server.js` — the smallest possible HTTP server whose only job is to hold the API key.

```text
Extension  →  POST http://localhost:8787/extract  →  bridge  →  OpenRouter
                    { imageBase64, mimeType }         (adds Authorization header)
```

Requirements:

- Key read from `process.env.OPENROUTER_API_KEY` via `dotenv`. `bridge/.env` is git-ignored; commit `bridge/.env.example` with an empty placeholder.
- CORS restricted to the extension origin (`chrome-extension://<id>`), not `*`.
- Bind to `127.0.0.1` only — never `0.0.0.0`. This service must not be reachable from the network.
- `GET /health` so the popup can show "bridge offline" instead of a generic failure.
- Log nothing but timing and status. **Never log the image, never write it to disk.** The bridge is a pass-through; it is not a store.
- Sensible request size limit (~10 MB) and a timeout (~30 s) so a hung upstream cannot wedge the pipeline.

Document in the README: `cd bridge && cp .env.example .env && npm start`.

Why a bridge at all: an API key inside a distributed extension is public — anyone can unzip the package and read it. This is spec §25.4, and it is the difference between a prototype we can demo publicly and one we cannot.

### A7 — Service-worker orchestrator (P3)

The single function that runs the pipeline. You own the file; Roles B and C provide the functions you call.

```js
async function preserve() {
  // No prompt of any kind here by design: the Preserve click runs the whole pipeline.
  emit("capture");
  const capture = await captureVisibleTab();

  emit("extract");
  const { providerId } = await settings.get();
  const provider = getProvider(providerId);
  const extraction = await provider.extract(capture).catch(toFailedResult);

  // everything below is Role B's API — you call it, you do not implement it
  const record = await lockEvidence({ capture, extraction, emit });

  emit("store");
  await vaultRepo.put(record);
  return { evidence_id: record.evidence_id };
}
```

Orchestrator rules:

- **Extraction failure never throws out of `preserve`.** Catch, convert to `status: "failed"`, continue.
- Emit a `PRESERVE_PROGRESS` message before each stage so the popup checklist is live.
- Guard against MV3 worker termination: the whole pipeline should complete in seconds; if the vision call is slow, keep the in-flight state in `chrome.storage.session` so a restarted worker can finish rather than losing the capture.
- The record is written to IndexedDB **once, at the end**. No partial records in the vault, ever.
- Wrap the whole thing so that if *anything* after capture fails, you still attempt a minimal "screenshot-only" preservation before surfacing the error. Losing a capture is the worst possible outcome for this product.

**Done when:** a single click completes end-to-end with real crypto and real storage, and killing the bridge, the network, or the AI mid-run still yields a stored, verifiable record.

---

## 4. Tools you use, and why

| Tool | What you use it for | Why this one |
|---|---|---|
| **Chromium MV3 extension APIs** | The whole shell | Only an extension can screenshot another site's tab; MV3 is the only version Chrome accepts for new extensions |
| **`chrome.tabs.captureVisibleTab()`** | The screenshot itself | Produces the real pixels the victim saw — our original artifact. No DOM dependency |
| **`activeTab` permission model** | Capture authorisation | Grants access only on explicit user gesture — the Preserve click is itself the authorisation — and avoids requesting all-site access from an at-risk user |
| **`createImageBitmap`** | True screenshot dimensions | Window size ≠ captured image size; the manifest must record the real thing |
| **`chrome.storage.local`** | Settings, provider choice, bridge URL | Small structured config, synchronous-ish access from both popup and worker. Not for evidence |
| **`chrome.storage.session`** | In-flight pipeline state | Survives MV3 service-worker termination without persisting sensitive data to disk |
| **`chrome.runtime.sendMessage`** | Popup ↔ worker protocol | The standard MV3 IPC; lets the popup close without killing the pipeline |
| **OpenRouter API** | Vision-language extraction | One endpoint, many models. If a model is rate-limited or deprecated, we change a config string instead of rewriting an integration |
| **Vision-language model (not DOM scraping)** | Reading the screenshot | DOM selectors on WhatsApp/Instagram/X break without warning; pixels do not. Makes extraction platform-agnostic (spec §8) |
| **`response_format: json_object` + our own validator** | Structured output | The output is about to be canonicalised and hashed — shape drift becomes a hash mismatch. We validate rather than trust |
| **Node + `node:http` or Express** | The local bridge | Minimal surface; the only requirement is "hold a secret and forward a request" |
| **`dotenv`** | Loading the API key | Keeps the key out of source and out of git history |
| **`DemoExtractionProvider`** | Offline/deterministic extraction | Guarantees the demo works with no network, and gives Roles B and C a stable input immediately |

---

## 5. Contracts you must not break

You **produce** `CaptureResult` (§5.1) and `ExtractionResult` (§5.2). Two people build against them.

- If a field needs to change, raise it in the daily sync and change `shared/types.js` in a PR that all three approve.
- Never add a field that is sometimes present. Absent data is `null`, always. Optional-vs-missing is a hashing bug waiting to happen.
- `ExtractionResult.status` must be exactly one of `ok` / `failed`. Role C renders different UI for each; Role B stores both identically.

---

## 6. Testing your slice

- **Unit (Vitest):** `schema.js` against malformed model outputs — markdown-fenced JSON, missing keys, wrong types, extra keys, empty `messages`, 500 messages, non-UTF8 junk. This is your highest-value test file.
- **Unit:** `prompt.js` output is stable (it feeds a request, not a hash, but drift here changes extraction quality silently).
- **Manual matrix:** capture on WhatsApp Web, Instagram DMs, X, a plain website, and `demo/chat.html`. Plus the negative cases: `chrome://extensions`, a PDF viewer tab, a page still loading.
- **Failure injection:** bridge stopped, bridge returning 500, bridge returning valid HTTP but invalid JSON, network disconnected mid-request, 30 s timeout. **Every one of these must still produce a stored evidence record.**

---

## 7. Definition of done

1. Extension loads clean in Chrome with no console errors.
2. `PRESERVE EVIDENCE` produces a spec-exact `CaptureResult` on real sites.
3. Preserving is one click — no dialog, disclosure, or confirmation step anywhere between the click and the stored record.
4. AI extraction runs on every preservation and yields validated, normalised structured metadata; when it fails, the record is still complete with `status: "failed"`.
6. Every AI failure mode degrades to a preserved record, never to a lost capture.
7. No API key exists anywhere in `extension/` or in git history.
8. The bridge binds to localhost only, restricts CORS to the extension, and logs no image data.
9. Progress checklist reflects real pipeline stages, not a fake animation.
10. `service-worker.js` calls Role B and Role C through their published functions only — no crypto or PDF logic in your files.
