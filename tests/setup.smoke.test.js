/**
 * EVOCK — foundation smoke test (Role B step 00).
 *
 * Proves the three things every later Role B module depends on: Web Crypto is
 * available, an IndexedDB implementation is registered, and fixtures load.
 */

import { describe, expect, it } from "vitest";
import { loadFixture, PNG_1x1_BYTES } from "./helpers/fixtures.js";

describe("test environment", () => {
  it("exposes crypto.subtle and digests SHA-256 to 32 bytes", async () => {
    expect(globalThis.crypto?.subtle).toBeDefined();

    const bytes = new TextEncoder().encode("abc");
    const digest = await crypto.subtle.digest("SHA-256", bytes);

    expect(digest.byteLength).toBe(32);
  });

  it("registers a global indexedDB implementation", () => {
    expect(globalThis.indexedDB).toBeDefined();
    expect(globalThis.IDBKeyRange).toBeDefined();
  });
});

describe("fixtures", () => {
  it("loads capture.sample with a screenshot data URL", () => {
    const capture = loadFixture("capture.sample");

    expect(capture).toHaveProperty("screenshotDataUrl");
    expect(capture.screenshotDataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("decodes the sample screenshot to real PNG bytes", () => {
    expect(PNG_1x1_BYTES).toBeInstanceOf(Uint8Array);
    // PNG magic number: 137 P N G
    expect(Array.from(PNG_1x1_BYTES.slice(0, 4))).toEqual([137, 80, 78, 71]);
  });

  it("loads every committed fixture", () => {
    for (const name of [
      "capture.sample",
      "extraction.ok.sample",
      "extraction.failed.sample",
      "manifest.sample",
      "record.sample"
    ]) {
      expect(loadFixture(name)).toBeTypeOf("object");
    }
  });
});
