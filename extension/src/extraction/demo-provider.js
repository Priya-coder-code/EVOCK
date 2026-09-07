/**
 * EVOCK - Demo Extraction Provider
 *
 * Implements DemoExtractionProvider according to Plan/Role A.md A4 and
 * Plan/Building Plan.md §5.2.
 *
 * Provides deterministic, offline structured extraction without requiring
 * OpenRouter, a local bridge, or an internet connection.
 */

/**
 * @typedef {Object} ExtractedMessage
 * @property {string|null} sender
 * @property {string|null} text
 * @property {string|null} visible_timestamp
 * @property {"incoming"|"outgoing"|null} type
 *
 * @typedef {Object} ExtractedData
 * @property {string|null} platform
 * @property {string|null} contact_name
 * @property {ExtractedMessage[]} messages
 * @property {string|null} visible_time
 * @property {string|null} date
 *
 * @typedef {Object} ExtractionResult
 * @property {"demo"|"vision"} provider
 * @property {string|null} model
 * @property {string|null} extractedAt
 * @property {ExtractedData|null} data
 * @property {"ok"|"failed"} status
 * @property {string|null} error
 */

/**
 * Helper to infer platform from capture domain for demo realism.
 * @param {string} domain
 * @returns {string}
 */
function inferPlatform(domain = "") {
  const d = domain.toLowerCase();
  if (d.includes("whatsapp")) return "WhatsApp";
  if (d.includes("instagram")) return "Instagram";
  if (d.includes("twitter") || d.includes("x.com")) return "X";
  if (d.includes("facebook") || d.includes("messenger")) return "Facebook Messenger";
  if (d.includes("telegram")) return "Telegram";
  return "Web Platform";
}

export class DemoExtractionProvider {
  constructor() {
    /** @type {"demo"} */
    this.id = "demo";
  }

  /**
   * Performs deterministic offline extraction.
   * Simulates ~600ms latency as specified in Plan/Role A.md A4.
   *
   * @param {Object} [capture] - The CaptureResult object from captureVisibleTab()
   * @returns {Promise<ExtractionResult>}
   */
  async extract(capture) {
    // Simulate ~600ms realistic processing delay
    await new Promise((resolve) => setTimeout(resolve, 600));

    const platform = inferPlatform(capture?.domain || "");
    const now = new Date().toISOString();

    /** @type {ExtractedMessage[]} */
    const messages = [
      {
        sender: "Mr. ABC B",
        text: "Sample preserved abusive message extracted by offline demo provider.",
        visible_timestamp: "11:28 PM",
        type: "incoming"
      }
    ];

    /** @type {ExtractedData} */
    const data = {
      platform,
      contact_name: "Mr. ABC B",
      messages,
      visible_time: "11:28 PM",
      date: "1 September 2026"
    };

    /** @type {ExtractionResult} */
    return {
      provider: "demo",
      model: "demo-offline-v1",
      extractedAt: now,
      data,
      status: "ok",
      error: null
    };
  }
}
