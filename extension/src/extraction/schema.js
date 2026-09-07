/**
 * EVOCK - Extraction Schema Validation & Normalization
 *
 * Implements defensive schema validation and normalization of model output
 * according to Plan/Role A.md A5 and Plan/Building Plan.md §5.2.
 *
 * The model output is treated as derived metadata. It is validated strictly,
 * normalized defensively, and never trusted blindly before hashing.
 */

/**
 * Maximum allowed messages in a single extraction result to prevent
 * hallucinated token bloating.
 */
export const MAX_MESSAGES_LIMIT = 50;

/**
 * Permitted message communication directions.
 */
export const ALLOWED_MESSAGE_TYPES = new Set(["incoming", "outgoing", "unknown"]);

/**
 * Common model-output placeholders for "not visible / missing" that must be
 * normalized to null for metadata fields. Message text is never altered.
 */
const NULL_PLACEHOLDER_PATTERN = /^(n\/?a|na|none|nil|unknown|-|n\/a)$/i;

/**
 * Normalizes a raw string field: trims, and converts missing/placeholder
 * values to null.
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeNullableString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || NULL_PLACEHOLDER_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Strips Markdown code block formatting (e.g. ```json ... ```) and extracts
 * the inner JSON string defensively.
 *
 * @param {string} text - Raw model string output
 * @returns {string} - Clean JSON string
 */
export function stripMarkdownFences(text) {
  if (typeof text !== "string") {
    return text;
  }

  let cleaned = text.trim();

  // Handle Markdown code block fences: ```json ... ``` or ``` ... ```
  const fenceRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = cleaned.match(fenceRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  } else if (cleaned.startsWith("```")) {
    // If opening fence is present without matched closing fence
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  }

  // If text contains preamble before first { or after last }, extract JSON object substring
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1).trim();
  }

  return cleaned;
}

/**
 * Normalizes and validates raw vision model output into a strictly conforming ExtractionResult.
 *
 * Never throws uncaught exceptions. If validation fails, returns a clean ExtractionResult
 * with status: "failed" and data: null per the EVOCK specification.
 *
 * @param {unknown} rawOutput - Raw string or parsed object from the model
 * @param {Object} [options]
 * @param {string} [options.provider="vision"] - Provider ID identifier
 * @param {string|null} [options.model=null] - Model name or path
 * @param {string} [options.fallbackError] - Custom failure error if rawOutput is absent
 * @returns {import('./demo-provider.js').ExtractionResult}
 */
export function validateAndNormalizeExtraction(rawOutput, options = {}) {
  const provider = options.provider || "vision";
  const model = options.model || null;
  const now = new Date().toISOString();

  // Handle null / undefined input
  if (rawOutput === null || rawOutput === undefined) {
    return {
      provider,
      model,
      extractedAt: now,
      data: null,
      status: "failed",
      error: options.fallbackError || "Model returned empty or null output."
    };
  }

  let parsed = rawOutput;

  // If raw output is a string, parse defensively
  if (typeof rawOutput === "string") {
    const cleanedString = stripMarkdownFences(rawOutput);
    try {
      parsed = JSON.parse(cleanedString);
    } catch (parseError) {
      return {
        provider,
        model,
        extractedAt: now,
        data: null,
        status: "failed",
        error: `Invalid JSON returned by model: ${parseError.message}`
      };
    }
  }

  // Top-level must be a plain object (not an array or primitive)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      provider,
      model,
      extractedAt: now,
      data: null,
      status: "failed",
      error: "Model output must be a valid JSON object."
    };
  }

  // Top-level field extraction with defensive type checks (numbers/booleans become null, not cast)
  const platform = normalizeNullableString(parsed.platform);
  const contact_name = normalizeNullableString(parsed.contact_name);
  const visible_time = normalizeNullableString(parsed.visible_time);
  const date = normalizeNullableString(parsed.date);

  // messages must always be an array; coerce non-array types to []
  const rawMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const normalizedMessages = [];

  for (const item of rawMessages) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }

    const sender = typeof item.sender === "string" ? (item.sender.trim() || null) : null;

    // Preserve message text faithfully without rewriting, summarizing, or cleaning up words.
    // Only surrounding leading/trailing whitespace is trimmed.
    const text = typeof item.text === "string" ? item.text.trim() : null;

    const visible_timestamp =
      typeof item.visible_timestamp === "string" ? (item.visible_timestamp.trim() || null) : null;

    // Validate type: must be "incoming" | "outgoing" | "unknown"
    let type = "unknown";
    if (typeof item.type === "string") {
      const normalizedType = item.type.trim().toLowerCase();
      if (ALLOWED_MESSAGE_TYPES.has(normalizedType)) {
        type = normalizedType;
      }
    }

    // Drop unknown keys on message item
    normalizedMessages.push({
      sender,
      text,
      visible_timestamp,
      type
    });
  }

  // Cap message list to reasonable maximum (50)
  const cappedMessages = normalizedMessages.slice(0, MAX_MESSAGES_LIMIT);

  // Return strictly conforming ExtractedData (unknown top-level keys dropped)
  return {
    provider,
    model,
    extractedAt: now,
    data: {
      platform,
      contact_name,
      messages: cappedMessages,
      visible_time,
      date
    },
    status: "ok",
    error: null
  };
}
