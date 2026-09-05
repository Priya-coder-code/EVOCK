# EVOCK — Digital Evidence Preservation for Online Abuse

## 1. Project Identity

**Project name:** EVOCK  
**Original challenge context:** Nari Kavach: Women Safety Innovation Challenge, Yantrika 1.0  
**Theme:** Cyber Safety  
**Team:** Yapocalypse  
**Current project focus:** Laptop/web prototype using a Chromium browser extension.

### Core idea

> EVOCK is a browser-based digital evidence preservation tool that lets a victim capture an online-abuse incident as a visual artifact, use vision AI to structure information visible in that capture, and cryptographically protect the resulting evidence package so later modification can be detected.

### Core tagline

> **Capture digital abuse before it disappears. Structure what was seen. Lock its integrity. Verify it later.**

---

# 2. Executive Summary

Digital abuse such as cyberstalking, harassment, threats, blackmail and impersonation often happens through browser-based communication and social platforms. The victim may see an important message or piece of content, but the content can later be deleted, unsent, edited, hidden, or otherwise become difficult to access.

The conventional response is often a screenshot or manually saved message. A screenshot is useful because it preserves the visual state that the victim saw, but by itself it does not create a structured evidence workflow. It does not inherently provide a cryptographic integrity record, a standardized incident record, or an easy mechanism for showing that the preserved file has not been altered later.

EVOCK addresses the preservation gap.

The user explicitly chooses **Preserve Evidence** from a Chromium browser extension. EVOCK captures a real screenshot of the current browser tab. For the refined architecture, a vision-language model can interpret the screenshot and extract information visibly present in it, such as the platform, account/contact identifier, visible message text, and visible timestamp. The screenshot remains the original visual artifact; the AI output is treated as derived metadata.

The screenshot, derived metadata and capture context are combined into an evidence package. The package is cryptographically protected using hashing, digital signatures, timestamp information and encryption. Evidence is stored locally in an encrypted vault and can later be verified. If the stored artifact is changed, the verification process can detect the mismatch.

The system is designed to support reporting and investigation. It does **not** claim to prove the truth of the conversation, identify the real-world person behind an account, access hidden platform backend records, recover deleted server-side data, reveal sender IP addresses, or guarantee legal admissibility.

---

# 3. Problem Statement

## 3.1 Exact problem

Women experiencing technology-facilitated abuse may encounter evidence in digital environments where the content is dynamic, removable, fragmented across multiple surfaces, and difficult to organize later.

Examples include:

- persistent unwanted messages;
- cyberstalking;
- direct threats;
- blackmail or extortion;
- impersonation;
- repeated contact from multiple accounts;
- threatening comments or posts;
- content that is later deleted, unsent, edited or inaccessible.

The critical problem is a **time-sensitive evidence-preservation gap**.

A victim may have access to the content at one moment, but by the time she decides to report it, the original content may no longer be available in exactly the same form.

## 3.2 Why the problem is more than "taking a screenshot"

### A. Ephemerality

A digital-abuse artifact may not remain available.

The attacker may:

- unsend a message;
- delete a post;
- delete an account;
- edit content;
- block the victim;
- move the conversation;
- switch accounts.

EVOCK therefore emphasizes:

> **Preserve first, before the content disappears.**

EVOCK does not claim to recover content that was never captured.

### B. Fragmentation

Evidence can be spread across:

- messages;
- profiles;
- comments;
- URLs;
- dates;
- multiple conversations;
- multiple accounts;
- multiple incidents.

A victim can end up with a folder full of screenshots without a unified record of what happened and in what order.

EVOCK treats each capture as an evidence record that can later belong to an incident timeline.

### C. Difficult later verification

A manually saved image does not inherently carry a cryptographic integrity workflow.

If a file is copied, edited, replaced or otherwise modified later, a person looking only at the file may not know whether it is identical to the originally preserved artifact.

EVOCK creates a cryptographic fingerprint and supporting verification information at the time of preservation.

### D. Context reconstruction

The screenshot may visually show a conversation, but useful structured fields may still need to be extracted for reporting or investigation.

Examples:

- platform;
- contact/account;
- visible message text;
- visible timestamp;
- relevant visible context.

EVOCK uses vision AI as an extraction layer rather than requiring a website to expose its internal DOM structure.

---

# 4. Problem Scope and Boundaries

## EVOCK is solving

> **How can a victim quickly preserve a currently visible online-abuse incident and turn it into a structured, tamper-evident record that can later be checked for integrity?**

## EVOCK is not solving

- universal recovery of deleted messages;
- hidden platform database access;
- attribution of an online account to a real-world person;
- IP tracing;
- automatic determination of criminal liability;
- guaranteed legal admissibility.

These boundaries are deliberate.

They keep the product technically defensible and prevent overclaiming.

---

# 5. Analysis of the Existing Evidence Workflow

## Typical current workflow

```text
Digital abuse occurs
        ↓
Victim notices it
        ↓
Screenshot / save manually
        ↓
Maybe copy message / URL
        ↓
File sits in gallery/files
        ↓
Content may disappear from platform
        ↓
Victim reports later
        ↓
Context must be reconstructed manually
```

This workflow preserves something, but preservation is not necessarily structured or integrity-oriented.

## EVOCK workflow

```text
Digital abuse occurs
        ↓
Victim notices it
        ↓
Preserve Evidence
        ↓
REAL browser screenshot
        ↓
Vision AI extracts visible information
        ↓
Evidence Bundle
        ↓
Cryptographic Lock
        ↓
Encrypted Local Vault
        ↓
Verification
        ↓
Report / Investigation
```

The distinction is:

> **A screenshot preserves pixels; an evidence record preserves the captured incident and its integrity metadata.**

---

# 6. Refined Solution

## 6.1 User-facing solution

EVOCK is a Chromium browser extension that provides a one-action evidence preservation workflow.

The user is on a web page containing abusive content and clicks the EVOCK extension.

The extension presents:

> **Preserve Evidence**

The user explicitly triggers preservation.

EVOCK captures the visible browser state.

The system can additionally use vision AI to read information visibly present in the screenshot and convert it into structured metadata.

The original screenshot remains part of the evidence package.

The resulting evidence is then:

1. hashed;
2. digitally signed;
3. timestamped;
4. encrypted;
5. stored locally;
6. later verified.

---

# 7. Core Product Principle: Original Evidence vs Derived Metadata

This is one of the most important architectural principles.

## Original evidence

The **actual screenshot** captured from the browser.

It represents what was visually present to the user at the moment of capture.

## Derived metadata

The output of the vision-language model.

Example:

```json
{
  "platform": "WhatsApp",
  "contact": "Mr. ABC B",
  "messages": [
    "Don't try to hide.....",
    "I know where you live"
  ],
  "visible_time": "11:28 PM"
}
```

The AI output is not considered a replacement for the screenshot.

Instead:

```text
SCREENSHOT
= ORIGINAL VISUAL ARTIFACT

VISION AI
= DERIVED STRUCTURED METADATA
```

This distinction addresses a major limitation of AI:

> A vision model can misread or misunderstand pixels.

Therefore, EVOCK preserves the original screenshot so the derived metadata can always be checked against the source image.

---

# 8. Why Use Vision AI Instead of DOM Extraction?

The earlier design attempted to use webpage DOM data.

That approach introduced a major practical dependency:

> The target website must expose the required information in a way the extension can access reliably.

Modern web applications can render interfaces dynamically, change DOM structures, use virtualized content, and update implementation details without warning.

That made DOM extraction a potentially brittle dependency.

## Refined approach

Instead of asking:

> "Can the website expose the message in a stable DOM structure?"

EVOCK asks:

> "What is visibly present in the screenshot?"

The workflow becomes:

```text
Rendered browser page
        ↓
Actual screenshot
        ↓
Vision-language model
        ↓
Visible information → structured JSON
```

This makes the extraction layer far less dependent on platform-specific HTML structure.

It also makes the architecture more platform-agnostic.

---

# 9. Vision AI Responsibilities

The vision model should have a narrow extraction role.

It should extract information that is visibly present, for example:

- platform name;
- account/contact identifier;
- visible message text;
- visible timestamp;
- visible date;
- other relevant visual context.

It should **not** be asked to make unsupported legal conclusions.

Prefer:

> "Extract only information visibly present in this screenshot. Do not infer missing information. Return null when a value is not readable or confidently identifiable."

## Example input

A screenshot may show:

```text
WhatsApp

Mr. ABC B

Don't try to hide.....
I know where you live

11:28 PM
```

## Example derived output

```json
{
  "platform": "WhatsApp",
  "contact_name": "Mr. ABC B",
  "messages": [
    {
      "sender": "Mr. ABC B",
      "text": "Don't try to hide.....",
      "visible_timestamp": "11:28 PM",
      "type": "incoming"
    },
    {
      "sender": "Mr. ABC B",
      "text": "I know where you live",
      "visible_timestamp": "11:28 PM",
      "type": "incoming"
    }
  ],
  "visible_time": "11:28 PM",
  "date": "1 September 2026"
}
```

The actual implementation must preserve the distinction between model-derived fields and original visual evidence.

---

# 10. End-to-End Architecture

```text
                         USER
                           │
                           ▼
                  Chromium Browser
                           │
                           ▼
                  EVOCK Extension
                           │
                  [PRESERVE EVIDENCE]
                           │
                           ▼
                     REAL SCREENSHOT
                           │
                           ▼
                  Explicit User Consent
                           │
                           ▼
                  Vision AI Extraction
                           │
                           ▼
                    Structured Metadata
                           │
               ┌───────────┴───────────┐
               ▼                       ▼
         ORIGINAL IMAGE          DERIVED METADATA
               │                       │
               ▼                       ▼
          SHA-256 HASH             SHA-256 HASH
               │                       │
               └───────────┬───────────┘
                           ▼
                    EVIDENCE MANIFEST
                           │
                           ▼
                    DIGITAL SIGNATURE
                           │
                           ▼
                  TIMESTAMP INFORMATION
                           │
                           ▼
                     AES-GCM ENCRYPTION
                           │
                           ▼
                    LOCAL EVIDENCE VAULT
                           │
                           ▼
                      VERIFICATION
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
          MATCH / VERIFIED       MISMATCH
                                   │
                                   ▼
                              MODIFICATION
                               DETECTED
                           │
                           ▼
                    EVIDENCE PACKAGE
```

---

# 11. Detailed Technical Flow

## Step 1 — Browser capture

The user clicks the EVOCK extension and explicitly selects:

> **Preserve Evidence**

The extension captures the current visible browser tab.

The screenshot is retained as the original evidence artifact.

The extension also records actual capture context such as:

- current URL;
- domain;
- capture time;
- screenshot dimensions.

## Step 2 — AI extraction

The screenshot is sent for vision analysis after user authorization.

The model produces structured metadata.

The output should be constrained to visually observable information.

## Step 3 — Evidence bundle

The original screenshot, derived metadata and capture context are combined into a versioned Evidence Manifest.

Conceptually:

```text
Evidence Manifest
├── source
├── capture
├── original artifact reference
├── AI-derived metadata
├── integrity fields
├── signature fields
└── timestamp fields
```

## Step 4 — Canonicalization

The evidence manifest is converted into a deterministic representation before hashing.

This prevents meaningless JSON formatting/property-order differences from producing inconsistent hashes.

## Step 5 — SHA-256

SHA-256 creates an integrity fingerprint.

The important conceptual meaning is:

> If the protected artifact changes, the fingerprint changes.

It does **not** prove:

- that the conversation is truthful;
- that the sender is the real-world person claimed;
- that the artifact is legally admissible.

## Step 6 — Digital signature

A signing key pair is generated and kept under local control for the prototype.

The evidence manifest or its protected hash is digitally signed.

A public key can later be used to verify that the signature matches the signed record.

## Step 7 — Timestamp

The system records the device/local capture timestamp.

If a real trusted timestamp authority is integrated, the system can additionally store a trusted timestamp record.

The architecture must distinguish:

```text
DEVICE CAPTURE TIME
vs.
TRUSTED TIMESTAMP
```

A device clock must not be described as an RFC 3161 trusted timestamp.

## Step 8 — Encryption

Sensitive evidence artifacts are encrypted using authenticated encryption, with the prototype targeting AES-GCM using a 256-bit key.

## Step 9 — Local vault

The encrypted artifact and associated evidence data are stored locally, using browser-native persistent storage such as IndexedDB.

## Step 10 — Verification

Verification recomputes the integrity fingerprint and verifies the digital signature.

Expected states:

```text
✓ INTEGRITY VERIFIED
```

or

```text
❌ MODIFICATION DETECTED
```

---

# 12. Evidence Record Model

A logical evidence record can look like:

```json
{
  "schema_version": "1.0",
  "evidence_id": "NK-0001",

  "source": {
    "capture_method": "browser_extension",
    "url": "https://web.whatsapp.com/..."
  },

  "capture": {
    "captured_at": "2026-09-01T23:31:14+05:30"
  },

  "visual_artifact": {
    "type": "screenshot",
    "storage": "encrypted"
  },

  "ai_derived_metadata": {
    "platform": "WhatsApp",
    "contact_name": "Mr. ABC B",
    "messages": [
      "Don't try to hide.....",
      "I know where you live"
    ],
    "visible_time": "11:28 PM",
    "date": "1 September 2026"
  },

  "integrity": {
    "hash_algorithm": "SHA-256",
    "screenshot_hash": "...",
    "metadata_hash": "...",
    "evidence_manifest_hash": "..."
  },

  "signature": {
    "algorithm": "ECDSA-P256",
    "public_key": "...",
    "signature": "..."
  },

  "timestamp": {
    "device_capture_time": "...",
    "trusted_timestamp_status": "not_configured"
  }
}
```

The actual implementation may use a more compact structure, but the conceptual separation should remain.

---

# 13. Dual Hashing Model

A strong design is to preserve separate fingerprints.

## Screenshot hash

```text
SHA-256(original screenshot bytes)
```

## Metadata hash

```text
SHA-256(canonical AI-derived metadata)
```

## Overall evidence hash

```text
SHA-256(
    screenshot_hash
    +
    metadata_hash
    +
    canonical capture context
)
```

This creates a hierarchy:

```text
              EVIDENCE PACKAGE
                     │
            ┌────────┴────────┐
            ▼                 ▼
       SCREENSHOT          METADATA
            │                 │
            ▼                 ▼
       HASH A             HASH B
            └────────┬────────┘
                     ▼
                  HASH C
```

Changing either the screenshot or the derived metadata should cause the overall fingerprint to change.

---

# 14. Local Privacy Architecture

The product should minimize unnecessary server-side storage.

Preferred architecture:

```text
Browser
  ↓
EVOCK Extension
  ↓
Screenshot
  ↓
User authorizes AI extraction
  ↓
Vision Service
  ↓
Structured metadata
  ↓
Evidence security processing
  ↓
Encrypted local vault
```

Important privacy clarification:

Because the refined design uses a remote vision API for the prototype, the statement:

> "Everything happens locally"

is no longer accurate.

The accurate description is:

> **Capture and long-term evidence storage are local; AI extraction is performed through the configured vision service after explicit user authorization.**

The user should be told when the screenshot will be transmitted for AI analysis.

---

# 15. Suggested User Flow

## Before capture

```text
EVOCK

Current browser:
WhatsApp

[ PRESERVE EVIDENCE ]
```

## Consent step

```text
PRESERVE EVIDENCE

A screenshot of the current browser
view will be analyzed by the selected
vision service to extract visible details.

[ ANALYZE & PRESERVE ]

[ PRESERVE WITHOUT AI ]
```

The second option is strategically useful because evidence preservation should not depend on AI availability.

## After capture

```text
✓ EVIDENCE PRESERVED

SCREENSHOT
[ preview ]

VISIBLE INFORMATION

Platform
WhatsApp

Contact
Mr. ABC B

Messages
"Don't try to hide....."
"I know where you live"

Visible time
11:28 PM

Date
1 September 2026

Integrity
✓ Fingerprint generated
```

Later stages add:

```text
Signature ✓
Timestamp ✓ / not configured
Encryption ✓
Integrity ✓
```

---

# 16. Evidence Vault

The vault should display a list of saved incidents:

```text
EVIDENCE VAULT

NK-0001   WhatsApp   Mr. ABC B
NK-0002   Instagram  @example
NK-0003   Website    unknown account
```

Opening an incident shows:

- original screenshot;
- derived metadata;
- capture context;
- hash;
- signature;
- timestamp status;
- encryption status;
- verification status.

---

# 17. Incident Timeline

A major product differentiator is organization across repeated events.

Example:

```text
12 Aug
E001 — Unwanted contact

13 Aug
E002 — Continued contact

14 Aug
E003 — Threatening message

15 Aug
E004 — New account continues contact
```

The product should use neutral wording.

Prefer:

> "Repeated contact across 4 captured incidents."

Avoid:

> "Confirmed stalker."

The system should organize facts rather than make unsupported legal or psychological conclusions.

---

# 18. Tamper Detection

The strongest technical demo is a controlled alteration.

Original:

```text
"I know where you live."
```

Modify stored evidence to:

```text
"I know where you live!!"
```

Verification:

```text
RECORDED HASH
83A91F...

CURRENT HASH
B72C19...

❌ MODIFICATION DETECTED
```

Restore the original:

```text
RECORDED HASH
83A91F...

CURRENT HASH
83A91F...

✓ INTEGRITY VERIFIED
```

This visibly demonstrates what the cryptographic layer contributes.

---

# 19. Export

Two outputs should be supported.

## Human-readable report

PDF containing:

- evidence ID;
- platform/source;
- contact/account;
- visible content;
- visible timestamp;
- capture timestamp;
- screenshot preview;
- SHA-256;
- signature status;
- timestamp status;
- integrity result;
- limitations.

## Machine-readable package

Conceptually:

```text
NK-0001/
├── manifest.json
├── screenshot.enc
├── signature.sig
└── verification.json
```

The exact implementation can vary.

---

# 20. Technology Stack

## Core application

- JavaScript
- Vite
- Chromium Manifest V3

## Capture

- Chromium browser extension APIs
- `chrome.tabs.captureVisibleTab()`

## AI extraction

- Vision-Language Model (VLM)
- OpenRouter API
- Structured JSON extraction

## Cryptography

- Web Crypto API
- SHA-256
- ECDSA P-256
- AES-GCM (256-bit)

## Storage

- IndexedDB

## Export

- jsPDF
- JSZip

## Timestamping

- Trusted timestamping abstraction
- RFC 3161-compatible timestamping support

## Optional/future

- TLSNotary
- OCR

---

# 21. Why This Technology Stack Is Appropriate

## JavaScript + Manifest V3

The product is fundamentally a browser extension, so browser-native web technologies minimize complexity.

## Vision-Language Model

A VLM can interpret visible information from screenshots without requiring the target website to expose stable DOM selectors.

## Web Crypto API

The prototype can use standardized browser cryptographic primitives without implementing cryptography from scratch.

## IndexedDB

Evidence can be persisted locally in the browser without requiring a cloud database for the core MVP.

## jsPDF + JSZip

These provide straightforward human-readable and machine-readable evidence exports.

---

# 22. Feasibility

## 22.1 Prototype feasibility

The current laptop/web prototype is highly feasible because the major components can be implemented independently.

### Development milestones already achieved

- Chromium Manifest V3 extension scaffold;
- popup;
- background service worker;
- content script;
- real screenshot capture;
- local demo webpage;
- visible-page extraction experiments;
- adapter architecture;
- fallback behavior when DOM data is unavailable;
- local Vite development environment.

The architecture was then refined to make screenshot capture the core and vision AI the metadata extraction layer.

## 22.2 Why the architecture is practical

The main pipeline is modular:

```text
Capture
   ↓
Extraction
   ↓
Evidence Builder
   ↓
Crypto
   ↓
Storage
   ↓
Verification
```

Each module can be tested independently.

The extraction provider can also be swapped:

```text
ExtractionProvider
├── DemoExtractionProvider
├── VisionExtractionProvider
└── DOMExtractionProvider (optional)
```

This means the evidence and cryptographic layers do not have to know whether metadata came from AI, DOM parsing, or another source.

---

# 25. Current Limitations

## 25.1 AI extraction can be wrong

A vision model may misread:

- names;
- timestamps;
- message text;
- small text;
- partially obscured text.

### Mitigation

- constrain extraction prompts;
- return `null` when uncertain;
- include confidence where useful;
- always preserve the original screenshot;
- clearly label AI output as derived metadata;
- allow human review before final locking.

---

## 25.2 Free AI API limits

A free API can have rate limits, model availability changes and temporary outages.

### Mitigation

- one AI request per preservation event;
- configurable vision provider;
- local preservation must not depend on successful AI extraction;
- support "Preserve Without AI";
- use deterministic demo mode for recorded demonstrations.

---

## 25.3 The screenshot must leave the device for remote AI analysis

This is the biggest privacy trade-off introduced by the revised architecture.

### Mitigation

- explicit consent before transmission;
- visible privacy disclosure;
- no unnecessary repeated uploads;
- preserve original screenshot locally;
- encrypt stored evidence;
- support a no-AI preservation path;
- future option: local/on-device VLM processing.

---

## 25.4 API key security

A secret API key should not be embedded directly into distributable extension code.

### Mitigation

Use a local backend/bridge during the prototype:

```text
Extension
   ↓
Local Node bridge
   ↓
AI provider
```

The key can remain in an environment variable on the developer machine.

For production, use a more sophisticated credential/service architecture.

---

## 25.5 AI is not proof of truth

An AI model may extract information correctly while the underlying digital event is still disputed.

### Mitigation

EVOCK treats the screenshot as the original visual artifact and the AI result as derived metadata.

The product claims integrity preservation, not universal truth determination.

---

## 25.6 Platform-specific limitations

The extension works with what is visible to the browser.

It does not obtain hidden backend information.

### Mitigation

Use screenshot-based extraction rather than relying on DOM structure.

Treat platform-specific integrations as adapters rather than assumptions built into the entire application.

---

## 25.7 Deleted content cannot be recovered if never captured

EVOCK cannot reconstruct content that never reached the capture system.

### Mitigation

Make preservation extremely fast and user-initiated:

> **Preserve before it disappears.**

---

## 25.8 Legal admissibility cannot be guaranteed

Different legal systems and individual cases can have different evidentiary requirements.

### Mitigation

Position EVOCK as:

> **A digital evidence preservation and integrity-verification tool designed to support reporting and investigation.**

Do not claim guaranteed court acceptance.

---

## 25.9 Attribution is not established automatically

Preserving an account name does not establish the real-world identity of the person operating the account.

### Mitigation

Preserve visible identifiers and context while explicitly leaving attribution to appropriate platform records and investigative processes.

---

## 25.10 Local-only storage creates device-loss risk

If evidence exists only on one device and the device is lost, the victim may lose access.

### Mitigation

Future architecture can provide optional encrypted backups.

The server should store ciphertext rather than plaintext evidence where practical.

---

## 25.11 Trusted timestamping is an external dependency

A local computer clock is not automatically a trusted timestamp authority.

### Mitigation

Store device capture time separately from any trusted timestamp.

Add an RFC 3161-compatible timestamp provider when production requirements justify it.

---

# 26. Future Improvements

## 26.1 On-device vision AI

The strongest long-term privacy improvement would be to run a capable VLM locally.

Then:

```text
Screenshot
   ↓
On-device VLM
   ↓
Metadata
```

would avoid sending sensitive screenshots to a third-party inference service.

The trade-off is higher local compute requirements.

## 26.2 Encrypted cloud backup

Offer optional encrypted backup for disaster recovery.

Architecture:

```text
Local encrypted evidence
        ↓
Optional encrypted backup
        ↓
Cloud storage
```

The server should not need plaintext access.

## 26.3 Stronger capture provenance

For supported environments, integrate additional provenance technologies such as trusted timestamping and, where technically appropriate, TLSNotary-style web provenance.

These should remain modular rather than being prerequisites for basic preservation.

## 26.4 Human verification workflow

Before locking, allow the user to review the AI-extracted record:

```text
AI extracted:

Contact: Rahul Sharma
Message: ...
Time: 10:42 PM

[ EDIT ]
[ ACCEPT & LOCK ]
```

Any human correction can itself become a separately identified action in the evidence history.

## 26.5 Multi-incident correlation

Future versions can group incidents across:

- multiple platforms;
- multiple accounts;
- dates;
- URLs;
- message patterns.

The system should remain descriptive and evidence-based rather than making unsupported accusations.

## 26.6 Additional capture sources

Future adapters could support:

- browser tabs;
- shared files;
- screen recordings;
- exported conversations;
- screenshots imported from outside the browser.

All sources can feed the same evidence core.

---

# 27. What EVOCK Can Prove vs What It Cannot

## Can establish within its architecture

- a visual artifact was captured;
- what information was extracted from that artifact;
- when the device recorded the capture;
- whether the protected artifact later changed;
- whether the evidence record's digital signature verifies;
- how multiple captured incidents relate chronologically;
- that an encrypted evidence package exists.

## Cannot independently establish

- the truthfulness of the underlying conversation;
- the real-world identity of an account owner;
- hidden platform/server records;
- sender IP information;
- deleted server-side content that was never captured;
- guaranteed legal admissibility.

---

# 28. Target Audience

## Primary audience

Women experiencing:

- cyberstalking;
- persistent harassment;
- threats;
- blackmail/extortion;
- impersonation;
- repeated unwanted online contact.

The product is particularly useful when the victim believes the content may disappear or when the abuse consists of multiple incidents rather than one isolated message.

## Secondary audience

### Investigators

Could benefit from:

- structured incident records;
- chronological evidence;
- integrity verification;
- evidence export.

### Lawyers / legal advisors

Could benefit from:

- organized evidence;
- visible source/context;
- cryptographic integrity information;
- human-readable reports.

EVOCK does not replace professional forensic examination or legal procedure.

---

# 29. Why the Product Is Needed

The need can be summarized as:

```text
ABUSE
  ↓
CONTENT IS AVAILABLE
  ↓
TIME PASSES
  ↓
CONTENT MAY CHANGE / DISAPPEAR
  ↓
REPORTING STARTS
  ↓
EVIDENCE MUST BE RECONSTRUCTED
```

EVOCK changes the critical moment to:

```text
ABUSE
  ↓
PRESERVE NOW
  ↓
STRUCTURE
  ↓
LOCK
  ↓
VERIFY LATER
```

The product therefore addresses a specific gap:

> **the period between encountering online abuse and beginning a formal reporting/investigation process.**

---

# 30. Impact

## For women

- faster evidence preservation;
- reduced burden of manually organizing screenshots;
- better protection against unnoticed later file modification;
- a clearer incident history.

## For investigators

- structured evidence records;
- chronological incident context;
- integrity-verification information;
- more consistent evidence packaging.

## For the reporting process

- improved organization before reporting;
- preservation before disappearance;
- clearer handoff from victim to investigator/legal advisor.

## Broader cyber-safety impact

The architecture could eventually be extended to more forms of technology-facilitated abuse and more evidence sources.

---

# 31. Why the Solution Is Innovative

The individual technologies are not themselves novel:

- screenshots;
- vision AI;
- SHA-256;
- digital signatures;
- encryption;
- local storage.

The innovation is in their combination into a **victim-side preservation workflow**.

The key product architecture is:

```text
VISIBLE DIGITAL ABUSE
        ↓
FAST USER-INITIATED CAPTURE
        ↓
AI-ASSISTED STRUCTURING
        ↓
CRYPTOGRAPHIC EVIDENCE LOCK
        ↓
LOCAL PROTECTED STORAGE
        ↓
LATER VERIFICATION
```

This moves the intervention point earlier in the process.

Traditional forensic tooling often enters after an investigator receives evidence.

EVOCK focuses on the moment when:

> **the victim first encounters the evidence and it is still available.**

---

# 32. Core Design Principles

## Principle 1 — Capture first

Do not let evidence preservation depend entirely on AI success.

## Principle 2 — Preserve the original

The screenshot remains the source visual artifact.

## Principle 3 — AI is derived, not authoritative

AI structures what it can see; it does not determine ultimate truth.

## Principle 4 — Cryptography protects integrity

Hashing, signing and verification detect modification.

## Principle 5 — Privacy is explicit

Remote AI processing requires user consent.

## Principle 6 — Legal claims stay limited

EVOCK supports preservation and investigation; it does not manufacture legal admissibility.

## Principle 7 — Failure should degrade gracefully

If the AI API fails:

```text
Screenshot
   ↓
Preserve
```

must still work.

---

# 36. What Should Never Be Claimed

Avoid:

- guaranteed court-admissible evidence;
- access to WhatsApp's private database;
- sender IP extraction;
- deleted-message recovery;
- AI proof that a conversation is genuine;
- AI proof that someone is a stalker;
- "everything is processed locally" when using a remote AI API;
- TLSNotary guarantees legal authenticity;
- hashing proves that a message is true.

Use:

- tamper-evident evidence package;
- client-visible evidence;
- AI-derived metadata;
- cryptographic integrity;
- designed to support reporting and investigation;
- preserve before it disappears.

---

# 37. Current MVP vs Long-Term Product

## Current MVP

```text
Browser Extension
      ↓
Real Screenshot
      ↓
Vision AI / Demo Extraction
      ↓
Structured Evidence
      ↓
SHA-256
      ↓
Digital Signature
      ↓
Encryption
      ↓
Local Vault
      ↓
Verification
      ↓
PDF / Machine-readable Export
```

## Future product

```text
Browser + Desktop + Mobile
            ↓
       Multi-source capture
            ↓
     On-device / hybrid AI
            ↓
     Evidence normalization
            ↓
       Strong provenance
            ↓
      Encrypted backup
            ↓
     Investigator workflows
```

---

# 38. Final Refined Problem Statement

> **Women facing cyberstalking, harassment, threats, blackmail and impersonation can encounter digital evidence that later disappears, changes or becomes difficult to organize. Existing manual preservation methods such as screenshots capture useful visual content but do not inherently provide a structured evidence workflow or cryptographic means of detecting later modification. The result is an evidence-preservation gap between the moment an incident is visible and the moment the victim reports it.**

---

# 39. Final Refined Solution Statement

> **EVOCK is a Chromium-based digital evidence preservation tool that lets a victim intentionally capture a real screenshot of online-abuse content before it disappears. A vision-language model can extract information visibly present in the screenshot into structured metadata, while the screenshot remains the original visual artifact. The screenshot, derived metadata and capture context are cryptographically bound using SHA-256, digital signatures and timestamp information, encrypted for protected local storage, and later verified to detect modification. The resulting incident records can be organized chronologically and exported for reporting and investigation.**

---

# 40. Final Product Definition

EVOCK can ultimately be summarized as:

```text
CAPTURE
What did the victim see?

        ↓

STRUCTURE
What visible information can be extracted?

        ↓

LOCK
Can the preserved record be protected against unnoticed alteration?

        ↓

VERIFY
Can we later detect if it changed?

        ↓

REPORT / INVESTIGATE
Can the victim provide an organized evidence package?
```

## Final one-line description

> **EVOCK turns a fragile screenshot into a structured, cryptographically protected and verifiable digital incident record.**
