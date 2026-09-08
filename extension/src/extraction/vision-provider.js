/**
 * EVOCK - Vision Extraction Provider
 *
 * Implements VisionExtractionProvider according to Plan/Role A.md A6
 * and Plan/Building Plan.md §3.3 & §5.2.
 *
 * Dispatches captured screenshots to the local Node.js bridge at
 * http://localhost:8787/extract, receives model completion, and validates
 * the structured JSON output through the A5 schema validator.
 *
 * All failures degrade cleanly to status: "failed" without throwing exceptions,
 * guaranteeing that screenshot preservation is never blocked by AI/bridge failures.
 */

import { EXTRACTION_SYSTEM_PROMPT, EXTRACTION_USER_PROMPT } from "./prompt.js";
import { validateAndNormalizeExtraction } from "./schema.js";

export const DEFAULT_BRIDGE_URL = "http://localhost:8787/extract";

/**
 * Hard ceiling for the extension -> bridge round trip. Slightly longer than the
 * bridge's own 30s upstream timeout, so a healthy bridge always answers first
 * and only a genuinely hung bridge trips this.
 */
export const BRIDGE_TIMEOUT_MS = 35000;

export class VisionExtractionProvider {
  constructor(bridgeUrl = DEFAULT_BRIDGE_URL) {
    /** @type {"vision"} */
    this.id = "vision";
    this.bridgeUrl = bridgeUrl;
  }

  /**
   * Run extraction via the local bridge and OpenRouter vision model.
   *
   * @param {Object} [capture] - The CaptureResult object from captureVisibleTab()
   * @returns {Promise<import('./demo-provider.js').ExtractionResult>}
   */
  async extract(capture) {
    // 1. Verify capture has a screenshot data URL
    if (!capture || !capture.screenshotDataUrl) {
      return validateAndNormalizeExtraction(null, {
        provider: "vision",
        model: null,
        fallbackError: "No screenshot provided to vision extraction provider."
      });
    }

    // Abort a hung bridge so extraction always resolves (Rule 2).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);

    try {
      // 2. Dispatch request to local bridge
      const response = await fetch(this.bridgeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image: capture.screenshotDataUrl,
          system: EXTRACTION_SYSTEM_PROMPT,
          prompt: EXTRACTION_USER_PROMPT
        }),
        signal: controller.signal
      });

      // 3. Handle bridge HTTP error responses (4xx / 5xx)
      if (!response.ok) {
        let errorDetails = `Bridge returned HTTP status ${response.status}`;
        try {
          const errorJson = await response.json();
          if (errorJson.error) {
            errorDetails = errorJson.error;
          }
        } catch {}

        return validateAndNormalizeExtraction(null, {
          provider: "vision",
          model: null,
          fallbackError: errorDetails
        });
      }

      // 4. Parse bridge response
      let bridgeData;
      try {
        bridgeData = await response.json();
      } catch (parseErr) {
        return validateAndNormalizeExtraction(null, {
          provider: "vision",
          model: null,
          fallbackError: `Failed to parse response from bridge: ${parseErr.message}`
        });
      }

      if (!bridgeData.ok || !bridgeData.content) {
        return validateAndNormalizeExtraction(null, {
          provider: "vision",
          model: bridgeData.model || null,
          fallbackError: bridgeData.error || "Bridge returned incomplete or invalid data."
        });
      }

      // 5. Pass model output through A5 schema validator
      return validateAndNormalizeExtraction(bridgeData.content, {
        provider: "vision",
        model: bridgeData.model || null
      });
    } catch (networkError) {
      // 6. Bridge offline, unreachable, or hung - degrade cleanly.
      const fallbackError = networkError && networkError.name === "AbortError"
        ? `Local bridge did not respond within ${BRIDGE_TIMEOUT_MS / 1000}s.`
        : `Could not connect to local bridge at ${this.bridgeUrl}. Please verify the bridge is running.`;
      return validateAndNormalizeExtraction(null, {
        provider: "vision",
        model: null,
        fallbackError
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
