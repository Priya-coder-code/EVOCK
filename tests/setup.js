/**
 * EVOCK — Vitest global setup.
 *
 * Registers an in-memory IndexedDB implementation (used from Role B step 03
 * onwards for the keystore and the evidence vault) and asserts that the Web
 * Crypto SubtleCrypto interface is available. Every Role B hash, signature and
 * encryption operation goes through crypto.subtle — if it is missing, the whole
 * slice is untestable and the failure should be loud and immediate.
 */

import "fake-indexeddb/auto";

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  throw new Error(
    "globalThis.crypto.subtle is unavailable. EVOCK requires the Web Crypto API " +
      "(Node 20+). Check the Node version used to run Vitest."
  );
}
