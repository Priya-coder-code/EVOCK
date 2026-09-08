import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node 20+ exposes globalThis.crypto.subtle natively, so Role B's crypto,
    // canonicalisation and verification modules can be tested headlessly.
    environment: "node",
    include: ["tests/**/*.test.js"],
    // tests/extraction-schema.test.js is Role A's hand-rolled harness: it exports
    // runTests() and is driven by tests/run-tests.py, not by Vitest. It is
    // excluded here rather than rewritten, because Role A owns that file.
    exclude: ["**/node_modules/**", "tests/extraction-schema.test.js"],
    setupFiles: ["tests/setup.js"]
  }
});
