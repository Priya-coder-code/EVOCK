/**
 * EVOCK — Evidence Manifest builder tests (Role B step 02, B2).
 *
 * The hashing order and the reduction rule are frozen once the first record is
 * stored. These tests are the guard on that.
 */

import { describe, expect, it, vi } from "vitest";
import {
  attachSignature,
  buildManifest,
  reduceManifestForHashing,
  SCHEMA_VERSION
} from "../../extension/src/evidence/manifest-builder.js";
import { dataUrlToBytes, sha256Bytes, sha256Canonical } from "../../extension/src/crypto/hash.js";
import { loadFixture } from "../helpers/fixtures.js";

const IV_B64 = "yv66vv7erb7u3d7e";
const PUBLIC_KEY_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "TEST_X_COORDINATE",
  y: "TEST_Y_COORDINATE",
  ext: true,
  key_ops: ["verify"]
};

function buildArgs(overrides = {}) {
  return {
    capture: loadFixture("capture.sample"),
    extraction: loadFixture("extraction.ok.sample"),
    evidence_id: "NK-0001",
    iv_b64: IV_B64,
    public_key_jwk: PUBLIC_KEY_JWK,
    ...overrides
  };
}

describe("buildManifest — schema completeness (§5.3)", () => {
  it("populates every key the manifest schema requires", async () => {
    const { manifest } = await buildManifest(buildArgs());

    expect(manifest.schema_version).toBe(SCHEMA_VERSION);
    expect(manifest.evidence_id).toBe("NK-0001");

    expect(manifest.source).toEqual({
      capture_method: "browser_extension.captureVisibleTab",
      url: "https://web.whatsapp.com/",
      domain: "web.whatsapp.com",
      tab_title: "WhatsApp"
    });

    expect(manifest.capture).toEqual({
      device_captured_at: "2026-09-01T23:31:14+05:30",
      screenshot_width: 1,
      screenshot_height: 1,
      mime_type: "image/png"
    });

    expect(manifest.visual_artifact).toEqual({
      type: "screenshot",
      storage: "encrypted",
      encryption: { algorithm: "AES-GCM", key_length: 256, iv: IV_B64 }
    });

    expect(manifest.ai_derived_metadata).toEqual({
      provider: "demo",
      model: "demo-offline-v1",
      status: "ok",
      extracted_at: "2026-09-01T23:31:19+05:30",
      data: loadFixture("extraction.ok.sample").data
    });

    expect(manifest.timestamp).toEqual({
      device_capture_time: "2026-09-01T23:31:14+05:30",
      trusted_timestamp_status: "not_configured",
      trusted_timestamp_token: null
    });
  });

  it("fills integrity completely and leaves the signature unsigned", async () => {
    const { manifest, screenshot_hash, metadata_hash, manifest_hash } =
      await buildManifest(buildArgs());

    expect(manifest.integrity.hash_algorithm).toBe("SHA-256");
    for (const hash of [screenshot_hash, metadata_hash, manifest_hash]) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.integrity.screenshot_hash).toBe(screenshot_hash);
    expect(manifest.integrity.metadata_hash).toBe(metadata_hash);
    expect(manifest.integrity.manifest_hash).toBe(manifest_hash);

    expect(manifest.signature.algorithm).toBe("ECDSA-P256-SHA256");
    expect(manifest.signature.public_key_jwk).toEqual(PUBLIC_KEY_JWK);
    expect(manifest.signature.signature).toBeNull();
    expect(manifest.signature.signed_at).toBeNull();
  });

  it("returns the decoded screenshot bytes it hashed", async () => {
    const args = buildArgs();
    const { screenshotBytes, screenshot_hash } = await buildManifest(args);

    expect(Array.from(screenshotBytes)).toEqual(
      Array.from(dataUrlToBytes(args.capture.screenshotDataUrl))
    );
    expect(await sha256Bytes(screenshotBytes)).toBe(screenshot_hash);
  });
});

describe("buildManifest — hashing order", () => {
  it("hashes the screenshot from decoded bytes, pre-encryption", async () => {
    const args = buildArgs();
    const { screenshot_hash } = await buildManifest(args);

    const expected = await sha256Bytes(dataUrlToBytes(args.capture.screenshotDataUrl));
    expect(screenshot_hash).toBe(expected);
  });

  it("hashes the whole ai_derived_metadata block canonically", async () => {
    const { manifest, metadata_hash } = await buildManifest(buildArgs());
    expect(metadata_hash).toBe(await sha256Canonical(manifest.ai_derived_metadata));
  });

  it("hashes the reduced manifest canonically", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs());
    expect(manifest_hash).toBe(await sha256Canonical(reduceManifestForHashing(manifest)));
  });

  it("covers provenance: changing provider changes metadata_hash", async () => {
    const base = await buildManifest(buildArgs());
    const swapped = await buildManifest(
      buildArgs({
        extraction: { ...loadFixture("extraction.ok.sample"), provider: "vision" }
      })
    );

    expect(swapped.metadata_hash).not.toBe(base.metadata_hash);
  });
});

describe("buildManifest — determinism", () => {
  it("produces identical hashes across two builds", async () => {
    const first = await buildManifest(buildArgs());
    const second = await buildManifest(buildArgs());

    expect(second.screenshot_hash).toBe(first.screenshot_hash);
    expect(second.metadata_hash).toBe(first.metadata_hash);
    expect(second.manifest_hash).toBe(first.manifest_hash);
  });

  it("produces identical hashes after a module reset", async () => {
    const first = await buildManifest(buildArgs());

    vi.resetModules();
    const reloaded = await import("../../extension/src/evidence/manifest-builder.js");
    const second = await reloaded.buildManifest(buildArgs());

    expect(second.manifest_hash).toBe(first.manifest_hash);
    expect(second.metadata_hash).toBe(first.metadata_hash);
  });

  it("is unaffected by the key order of the inputs", async () => {
    const capture = loadFixture("capture.sample");
    const reordered = Object.fromEntries(Object.entries(capture).reverse());

    const first = await buildManifest(buildArgs());
    const second = await buildManifest(buildArgs({ capture: reordered }));

    expect(second.manifest_hash).toBe(first.manifest_hash);
  });
});

describe("buildManifest — metadata sensitivity", () => {
  it("changes metadata_hash when one character of one message changes", async () => {
    const extraction = loadFixture("extraction.ok.sample");
    const tampered = loadFixture("extraction.ok.sample");
    tampered.data.messages[0].text = `${tampered.data.messages[0].text}.`;

    const base = await buildManifest(buildArgs({ extraction }));
    const changed = await buildManifest(buildArgs({ extraction: tampered }));

    expect(changed.metadata_hash).not.toBe(base.metadata_hash);
    expect(changed.screenshot_hash).toBe(base.screenshot_hash);
  });

  it("changes metadata_hash when the messages array is reordered", async () => {
    const twoMessages = loadFixture("extraction.ok.sample");
    twoMessages.data.messages.push({
      sender: "Mr. ABC B",
      text: "second message",
      visible_timestamp: "11:29 PM",
      type: "incoming"
    });

    const reversed = JSON.parse(JSON.stringify(twoMessages));
    reversed.data.messages.reverse();

    const base = await buildManifest(buildArgs({ extraction: twoMessages }));
    const flipped = await buildManifest(buildArgs({ extraction: reversed }));

    expect(flipped.metadata_hash).not.toBe(base.metadata_hash);
  });

  it("leaves metadata_hash unchanged when an unrelated key is reordered", async () => {
    const extraction = loadFixture("extraction.ok.sample");
    const reordered = Object.fromEntries(Object.entries(extraction).reverse());
    reordered.data = Object.fromEntries(Object.entries(extraction.data).reverse());

    const base = await buildManifest(buildArgs({ extraction }));
    const shuffled = await buildManifest(buildArgs({ extraction: reordered }));

    expect(shuffled.metadata_hash).toBe(base.metadata_hash);
    expect(shuffled.manifest_hash).toBe(base.manifest_hash);
  });
});

describe("buildManifest — failed extraction", () => {
  it("builds a complete manifest when extraction returned no data", async () => {
    const extraction = loadFixture("extraction.failed.sample");
    const { manifest, metadata_hash, screenshot_hash } = await buildManifest(
      buildArgs({ extraction })
    );

    expect(manifest.ai_derived_metadata).toEqual({
      provider: "vision",
      model: null,
      status: "failed",
      extracted_at: "2026-09-01T23:31:19+05:30",
      data: null
    });
    expect(metadata_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(screenshot_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a stable metadata_hash for the failed case", async () => {
    const extraction = loadFixture("extraction.failed.sample");
    const first = await buildManifest(buildArgs({ extraction }));
    const second = await buildManifest(buildArgs({ extraction }));

    expect(second.metadata_hash).toBe(first.metadata_hash);
  });

  it("distinguishes a failed extraction from a successful one", async () => {
    const failed = await buildManifest(
      buildArgs({ extraction: loadFixture("extraction.failed.sample") })
    );
    const ok = await buildManifest(buildArgs());

    expect(failed.metadata_hash).not.toBe(ok.metadata_hash);
  });
});

describe("reduceManifestForHashing", () => {
  it("removes exactly manifest_hash and signature, and nothing else", async () => {
    const { manifest } = await buildManifest(buildArgs());
    const reduced = reduceManifestForHashing(manifest);

    expect(reduced.signature).toBeUndefined();
    expect("manifest_hash" in reduced.integrity).toBe(false);

    // Everything else survives.
    expect(reduced.integrity.screenshot_hash).toBe(manifest.integrity.screenshot_hash);
    expect(reduced.integrity.metadata_hash).toBe(manifest.integrity.metadata_hash);
    expect(reduced.integrity.hash_algorithm).toBe("SHA-256");

    const expectedKeys = Object.keys(manifest).filter((k) => k !== "signature").sort();
    expect(Object.keys(reduced).sort()).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      if (key !== "integrity") expect(reduced[key]).toEqual(manifest[key]);
    }
  });

  it("does not mutate its input", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs());
    const before = JSON.parse(JSON.stringify(manifest));

    reduceManifestForHashing(manifest);

    expect(manifest).toEqual(before);
    expect(manifest.integrity.manifest_hash).toBe(manifest_hash);
    expect(manifest.signature).toBeDefined();
  });

  it("is stable when called repeatedly", async () => {
    const { manifest } = await buildManifest(buildArgs());
    expect(await sha256Canonical(reduceManifestForHashing(manifest))).toBe(
      await sha256Canonical(reduceManifestForHashing(manifest))
    );
  });

  it("rejects a non-manifest input", () => {
    expect(() => reduceManifestForHashing(null)).toThrow(TypeError);
    expect(() => reduceManifestForHashing("nope")).toThrow(TypeError);
  });
});

describe("attachSignature", () => {
  it("writes the signature block without disturbing the hashes", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs());

    attachSignature(manifest, {
      signature_b64: "c2lnbmF0dXJl",
      public_key_jwk: PUBLIC_KEY_JWK,
      signed_at: "2026-09-01T23:31:20+05:30"
    });

    expect(manifest.signature).toEqual({
      algorithm: "ECDSA-P256-SHA256",
      public_key_jwk: PUBLIC_KEY_JWK,
      signature: "c2lnbmF0dXJl",
      signed_at: "2026-09-01T23:31:20+05:30"
    });
    expect(manifest.integrity.manifest_hash).toBe(manifest_hash);
  });

  it("does not change manifest_hash, because the signature block is excluded", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs());

    attachSignature(manifest, {
      signature_b64: "c2lnbmF0dXJl",
      signed_at: "2026-09-01T23:31:20+05:30"
    });

    expect(await sha256Canonical(reduceManifestForHashing(manifest))).toBe(manifest_hash);
  });

  it("keeps the existing public key when none is supplied", async () => {
    const { manifest } = await buildManifest(buildArgs());

    attachSignature(manifest, { signature_b64: "sig", signed_at: "now" });

    expect(manifest.signature.public_key_jwk).toEqual(PUBLIC_KEY_JWK);
  });

  it("refuses to sign a manifest whose hash has not been computed", () => {
    expect(() =>
      attachSignature({ integrity: {} }, { signature_b64: "sig", signed_at: "now" })
    ).toThrow(/manifest_hash/);
  });
});

describe("buildManifest — input validation", () => {
  it("rejects a missing capture or extraction", async () => {
    await expect(buildManifest(buildArgs({ capture: null }))).rejects.toThrow(TypeError);
    await expect(buildManifest(buildArgs({ extraction: null }))).rejects.toThrow(TypeError);
  });

  it("rejects a capture whose screenshot is not a base64 data URL", async () => {
    const capture = loadFixture("capture.sample");
    capture.screenshotDataUrl = "https://example.com/shot.png";

    await expect(buildManifest(buildArgs({ capture }))).rejects.toThrow(TypeError);
  });

  it("accepts a null evidence_id, for allocation at write time", async () => {
    const { manifest } = await buildManifest(buildArgs({ evidence_id: null }));
    expect(manifest.evidence_id).toBeNull();
  });
});

describe("buildManifest — required cryptographic parameters", () => {
  it("refuses to build without an IV", async () => {
    // Canonicalisation drops an undefined key, so a missing IV would produce a
    // manifest that hashes and verifies cleanly but whose screenshot can never
    // be decrypted. That must fail at build time, not at decrypt time.
    await expect(buildManifest(buildArgs({ iv_b64: undefined }))).rejects.toThrow(/iv_b64/);
    await expect(buildManifest(buildArgs({ iv_b64: "" }))).rejects.toThrow(/iv_b64/);
  });

  it("refuses to build without a public key", async () => {
    await expect(buildManifest(buildArgs({ public_key_jwk: undefined }))).rejects.toThrow(
      /public_key_jwk/
    );
    await expect(buildManifest(buildArgs({ public_key_jwk: null }))).rejects.toThrow(
      /public_key_jwk/
    );
  });

  it("keeps the IV in the canonical form it hashes", async () => {
    const { manifest } = await buildManifest(buildArgs());
    const { canonicalize } = await import("../../extension/src/evidence/canonicalize.js");

    expect(canonicalize(manifest.visual_artifact)).toContain(`"iv":"${IV_B64}"`);
  });
});

describe("buildManifest — survives the storage and export round trips", () => {
  it("hashes identically after a structured clone (the IndexedDB path)", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs());
    const cloned = structuredClone(manifest);

    expect(await sha256Canonical(reduceManifestForHashing(cloned))).toBe(manifest_hash);
  });

  it("hashes identically after a JSON round trip (the export path)", async () => {
    // A third party verifying an exported ZIP reads manifest.json from disk.
    const { manifest, manifest_hash } = await buildManifest(buildArgs());
    const reloaded = JSON.parse(JSON.stringify(manifest));

    expect(await sha256Canonical(reduceManifestForHashing(reloaded))).toBe(manifest_hash);
  });

  it("still hashes to manifest_hash once a signature is attached", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs());
    attachSignature(manifest, { signature_b64: "c2ln", signed_at: "2026-09-01T23:31:20+05:30" });

    expect(await sha256Canonical(reduceManifestForHashing(manifest))).toBe(manifest_hash);
  });
});

describe("buildManifest — evidence_id is covered by manifest_hash", () => {
  // This is an executable statement of a constraint the storage layer must
  // honour: the id is inside the signed manifest, so it cannot be assigned
  // after signing. Steps 06 and 07 have to allocate it before the build.
  it("produces different hashes for different ids", async () => {
    const first = await buildManifest(buildArgs({ evidence_id: "NK-0001" }));
    const second = await buildManifest(buildArgs({ evidence_id: "NK-0002" }));
    const none = await buildManifest(buildArgs({ evidence_id: null }));

    expect(new Set([first.manifest_hash, second.manifest_hash, none.manifest_hash]).size).toBe(3);
  });

  it("breaks verification if the id is written in after the hash is computed", async () => {
    const { manifest, manifest_hash } = await buildManifest(buildArgs({ evidence_id: null }));

    const late = structuredClone(manifest);
    late.evidence_id = "NK-0001";

    expect(await sha256Canonical(reduceManifestForHashing(late))).not.toBe(manifest_hash);
  });
});

describe("buildManifest — the manifest is independent of its inputs", () => {
  // lockEvidence receives capture and extraction from Role A's orchestrator,
  // which still holds those objects. If the manifest shares structure with them,
  // any later touch silently invalidates hashes that were already computed, and
  // the first verify reports MODIFIED on evidence nobody tampered with.
  it("does not alias the extraction's data", async () => {
    const args = buildArgs();
    const { manifest } = await buildManifest(args);

    expect(manifest.ai_derived_metadata.data).not.toBe(args.extraction.data);
    expect(manifest.ai_derived_metadata.data).toEqual(args.extraction.data);
  });

  it("does not alias the public key", async () => {
    const args = buildArgs();
    const { manifest } = await buildManifest(args);

    expect(manifest.signature.public_key_jwk).not.toBe(args.public_key_jwk);
    expect(manifest.signature.public_key_jwk).toEqual(args.public_key_jwk);
  });

  it("keeps both hashes valid when the caller mutates the extraction afterwards", async () => {
    const args = buildArgs();
    const { manifest, manifest_hash, metadata_hash } = await buildManifest(args);

    args.extraction.data.messages[0].text = "mutated after the fact";
    args.extraction.data.messages.push({
      sender: "X",
      text: "added after the fact",
      visible_timestamp: null,
      type: "incoming"
    });

    expect(await sha256Canonical(manifest.ai_derived_metadata)).toBe(metadata_hash);
    expect(await sha256Canonical(reduceManifestForHashing(manifest))).toBe(manifest_hash);
    expect(manifest.ai_derived_metadata.data.messages).toHaveLength(1);
    expect(manifest.ai_derived_metadata.data.messages[0].text).not.toContain("mutated");
  });

  it("does not mutate the capture or extraction it was given", async () => {
    const args = buildArgs();
    const captureBefore = JSON.parse(JSON.stringify(args.capture));
    const extractionBefore = JSON.parse(JSON.stringify(args.extraction));

    await buildManifest(args);

    expect(args.capture).toEqual(captureBefore);
    expect(args.extraction).toEqual(extractionBefore);
  });
});

describe("attachSignature — required arguments", () => {
  it("refuses an absent or empty signature", async () => {
    const { manifest } = await buildManifest(buildArgs());

    expect(() => attachSignature(manifest, { signed_at: "now" })).toThrow(/signature_b64/);
    expect(() => attachSignature(manifest, { signature_b64: "", signed_at: "now" })).toThrow(
      /signature_b64/
    );
  });

  it("refuses an absent signed_at", async () => {
    const { manifest } = await buildManifest(buildArgs());

    expect(() => attachSignature(manifest, { signature_b64: "c2ln" })).toThrow(/signed_at/);
  });
});
