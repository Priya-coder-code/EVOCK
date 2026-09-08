/**
 * EVOCK - Extraction Provider Architecture
 *
 * Implements the ExtractionProvider interface and provider registry according
 * to Plan/Role A.md A4 and Plan/Building Plan.md §5.2.
 */

import { DemoExtractionProvider } from "./demo-provider.js";
import { VisionExtractionProvider } from "./vision-provider.js";

/**
 * @typedef {import('./demo-provider.js').ExtractionResult} ExtractionResult
 *
 * @typedef {Object} ExtractionProvider
 * @property {"demo"|"vision"} id
 * @property {(capture: object) => Promise<ExtractionResult>} extract
 *   Must resolve (never reject) - a failure is an ExtractionResult with
 *   status: "failed", so preservation is never blocked by extraction.
 */

/**
 * Storage key for persisting selected provider choice.
 */
export const STORAGE_KEY_PROVIDER_ID = "extractionProviderId";

/**
 * Default provider when none is configured. The team chose "vision" as the
 * default (see git history); "demo" remains the offline-safe fallback.
 */
export const DEFAULT_PROVIDER_ID = "vision";

/** Every valid provider id. */
export const PROVIDER_IDS = Object.freeze(["demo", "vision"]);

/**
 * Internal registry of available providers.
 * Both implement { id: "demo"|"vision", extract(capture): Promise<ExtractionResult> }
 * @type {Record<string, ExtractionProvider>}
 */
const registry = {
  demo: new DemoExtractionProvider(),
  vision: new VisionExtractionProvider()
};

// Fail loud in dev if a registry entry ever stops satisfying the interface.
for (const [id, impl] of Object.entries(registry)) {
  if (impl.id !== id || typeof impl.extract !== "function") {
    console.error(`EVOCK: provider "${id}" does not satisfy the ExtractionProvider interface.`);
  }
}

/**
 * Returns an ExtractionProvider instance by ID.
 * Falls back to DEFAULT_PROVIDER_ID ("vision") if the given ID is unrecognized.
 *
 * @param {string} [id="vision"]
 * @returns {DemoExtractionProvider|VisionExtractionProvider}
 */
export function getProvider(id = DEFAULT_PROVIDER_ID) {
  if (id && registry[id]) {
    return registry[id];
  }
  console.warn(`Extraction provider "${id}" not found. Falling back to "${DEFAULT_PROVIDER_ID}".`);
  return registry[DEFAULT_PROVIDER_ID];
}

/**
 * Returns metadata for all available extraction providers.
 *
 * @returns {Array<{ id: string, label: string, description: string }>}
 */
export function listProviders() {
  return [
    {
      id: "demo",
      label: "Demo Provider (Offline)",
      description: "Deterministic offline extraction without network calls"
    },
    {
      id: "vision",
      label: "Vision AI Provider (OpenRouter)",
      description: "Local Node bridge to OpenRouter VLM (A5/A6)"
    }
  ];
}

/**
 * Build a contract-valid failed ExtractionResult (Building Plan §5.2).
 * Used by the orchestrator's `.catch(...)` so a thrown provider error never
 * produces an off-contract `provider: "unknown"` record.
 *
 * @param {unknown} error
 * @param {"demo"|"vision"} [providerId=DEFAULT_PROVIDER_ID]
 * @returns {ExtractionResult}
 */
export function toFailedResult(error, providerId = DEFAULT_PROVIDER_ID) {
  return {
    provider: registry[providerId] ? providerId : DEFAULT_PROVIDER_ID,
    model: null,
    extractedAt: new Date().toISOString(),
    data: null,
    status: "failed",
    error: (error && error.message) ? String(error.message) : String(error || "Extraction failed.")
  };
}

/**
 * Retrieves the currently active provider ID from chrome.storage.local.
 * Defaults to DEFAULT_PROVIDER_ID ("vision").
 *
 * @returns {Promise<string>}
 */
export async function getSelectedProviderId() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const result = await chrome.storage.local.get(STORAGE_KEY_PROVIDER_ID);
      const savedId = result[STORAGE_KEY_PROVIDER_ID];
      if (savedId && registry[savedId]) {
        return savedId;
      }
    }
  } catch (error) {
    console.warn("Could not read provider ID from chrome.storage.local:", error);
  }
  return DEFAULT_PROVIDER_ID;
}

/**
 * Persists the chosen provider ID to chrome.storage.local.
 *
 * @param {string} providerId
 * @returns {Promise<void>}
 */
export async function setSelectedProviderId(providerId) {
  if (!registry[providerId]) {
    throw new Error(
      `Invalid provider ID: "${providerId}". Valid options are: ${Object.keys(registry).join(", ")}`
    );
  }

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({
      [STORAGE_KEY_PROVIDER_ID]: providerId
    });
  }
}
