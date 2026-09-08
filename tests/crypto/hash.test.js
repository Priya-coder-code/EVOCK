/**
 * EVOCK — SHA-256 primitive tests (Role B step 02, B2).
 */

import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  dataUrlToBytes,
  sha256Bytes,
  sha256Canonical,
  sha256Utf8
} from "../../extension/src/crypto/hash.js";
import { loadFixture, PNG_1x1_BYTES } from "../helpers/fixtures.js";

// Published SHA-256 digests. If either of these ever fails, the digest path is
// wrong and nothing downstream can be trusted.
const SHA256_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("sha256Utf8 — known answers", () => {
  it("hashes the empty string to the published digest", async () => {
    expect(await sha256Utf8("")).toBe(SHA256_EMPTY);
  });

  it('hashes "abc" to the published digest', async () => {
    expect(await sha256Utf8("abc")).toBe(SHA256_ABC);
  });

  it("returns lowercase hex of 64 characters", async () => {
    const digest = await sha256Utf8("evock");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes UTF-8 bytes, not UTF-16 code units", async () => {
    // "é" is two bytes in UTF-8; hashing the JS string's code units would differ.
    const viaBytes = await sha256Bytes(new TextEncoder().encode("é"));
    expect(await sha256Utf8("é")).toBe(viaBytes);
  });
});

describe("sha256Bytes", () => {
  it("is stable across calls for the sample screenshot", async () => {
    const first = await sha256Bytes(PNG_1x1_BYTES);
    const second = await sha256Bytes(PNG_1x1_BYTES);
    expect(second).toBe(first);
  });

  it("matches the bytes decoded from the capture fixture's data URL", async () => {
    const capture = loadFixture("capture.sample");
    const decoded = dataUrlToBytes(capture.screenshotDataUrl);

    expect(await sha256Bytes(decoded)).toBe(await sha256Bytes(PNG_1x1_BYTES));
  });

  it("accepts an ArrayBuffer and a typed-array view alike", async () => {
    const view = PNG_1x1_BYTES;
    const buffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    expect(await sha256Bytes(buffer)).toBe(await sha256Bytes(view));
  });

  it("changes when one byte changes", async () => {
    const mutated = Uint8Array.from(PNG_1x1_BYTES);
    mutated[mutated.length - 1] ^= 0xff;

    expect(await sha256Bytes(mutated)).not.toBe(await sha256Bytes(PNG_1x1_BYTES));
  });

  it("refuses to hash a string, pointing at sha256Utf8", async () => {
    await expect(sha256Bytes("abc")).rejects.toThrow(/sha256Utf8/);
  });

  it("rejects values that are not byte sources", async () => {
    await expect(sha256Bytes({})).rejects.toThrow(TypeError);
    await expect(sha256Bytes(null)).rejects.toThrow(TypeError);
  });
});

describe("sha256Canonical", () => {
  it("is independent of key insertion order", async () => {
    expect(await sha256Canonical({ a: 1, b: 2 })).toBe(await sha256Canonical({ b: 2, a: 1 }));
  });

  it("equals hashing the canonical text directly", async () => {
    expect(await sha256Canonical({ b: 2, a: 1 })).toBe(await sha256Utf8('{"a":1,"b":2}'));
  });

  it("changes when a value changes", async () => {
    expect(await sha256Canonical({ a: 1 })).not.toBe(await sha256Canonical({ a: 2 }));
  });

  it("distinguishes null from a missing key", async () => {
    expect(await sha256Canonical({ a: null })).not.toBe(await sha256Canonical({}));
  });
});

describe("dataUrlToBytes", () => {
  it("decodes the sample screenshot to real PNG bytes", () => {
    const capture = loadFixture("capture.sample");
    const bytes = dataUrlToBytes(capture.screenshotDataUrl);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
    expect(bytes.length).toBe(PNG_1x1_BYTES.length);
  });

  it("decodes to the same bytes as the test helper", () => {
    const capture = loadFixture("capture.sample");
    expect(Array.from(dataUrlToBytes(capture.screenshotDataUrl))).toEqual(
      Array.from(PNG_1x1_BYTES)
    );
  });

  it("rejects anything that is not a base64 data URL", () => {
    expect(() => dataUrlToBytes("https://example.com/a.png")).toThrow(TypeError);
    expect(() => dataUrlToBytes("data:image/png")).toThrow(TypeError);
    expect(() => dataUrlToBytes("data:text/plain,hello")).toThrow(/base64/);
    expect(() => dataUrlToBytes(null)).toThrow(TypeError);
  });
});

describe("bytesToHex", () => {
  it("zero-pads each byte to two lowercase hex digits", () => {
    expect(bytesToHex(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
  });

  it("returns an empty string for no bytes", () => {
    expect(bytesToHex(new Uint8Array([]))).toBe("");
  });
});
