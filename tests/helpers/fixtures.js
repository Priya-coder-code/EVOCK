/**
 * EVOCK — test fixture loader.
 *
 * Role B builds entirely against tests/fixtures/ until the upstream Role A
 * modules are wired in (Building Plan §7, "Fixture-first").
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures"
);

/**
 * Load a fixture by name, with or without the `.json` suffix.
 * Returns a freshly parsed object on every call, so a test may mutate its copy
 * without leaking that change into another test.
 *
 * @param {string} name e.g. "capture.sample" or "capture.sample.json"
 * @returns {any}
 */
export function loadFixture(name) {
  const fileName = name.endsWith(".json") ? name : `${name}.json`;
  const filePath = path.join(FIXTURE_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * Decode a `data:` URL into its raw bytes.
 * Hashing must always run over decoded bytes, never over the base64 text
 * (Role B.md §B2) — this helper exists so tests exercise the same assumption.
 *
 * @param {string} dataUrl
 * @returns {Uint8Array}
 */
export function dataUrlToBytesForTest(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Raw bytes of the 1x1 PNG carried by capture.sample.json.
 * @type {Uint8Array}
 */
export const PNG_1x1_BYTES = dataUrlToBytesForTest(
  loadFixture("capture.sample").screenshotDataUrl
);
