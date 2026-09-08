/**
 * EVOCK - Extraction Provider Architecture
 *
 * Implements the ExtractionProvider interface and provider registry according
 * to Plan/Role A.md A4 and Plan/Building Plan.md §5.2.
 */

import { DemoExtractionProvider } from "./demo-provider.js";
import { VisionExtractionProvider } from "./vision-provider.js";

/**
 * Storage key for persisting selected provider choice.
 */
export const STORAGE_KEY_PROVIDER_ID = "extractionProviderId";

/**
 * Default provider to use when none is explicitly configured.
 */
export const DEFAULT_PROVIDER_ID = "vision";

/**
 * Internal registry of available providers.
 * Both implement { id: string, extract(capture): Promise<ExtractionResult> }
 */
const registry = {
  demo: new DemoExtractionProvider(),
  vision: new VisionExtractionProvider()
};

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
 * Retrieves the currently active provider ID from chrome.storage.local.
 * Defaults to "demo".
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
