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
 * Model-output placeholders for "not applicable / missing" that must be
 * normalized to null for metadata fields, so the same screenshot always
 * hashes the same. Deliberately narrow: "unknown" and "-" are NOT included -
 * they can be a real visible value and the model is told to emit null itself.
 * Message text is never altered.
 */
const NULL_PLACEHOLDER_PATTERN = /^(n\/?a|none|nil|null)$/i;

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
 * Strips Markdown code-block fences (```json ... ``` or ``` ... ```) from a raw
 * model string. It does NOT trim to the outermost braces - that is a lossy
 * salvage step only worth doing after a direct parse has already failed
 * (see extractJsonObject), because a `}` inside a message string would
 * otherwise truncate valid JSON.
 *
 * @param {string} text - Raw model string output
 * @returns {string} - The string with surrounding fences removed
 */
export function stripMarkdownFences(text) {
  if (typeof text !== "string") {
    return text;
  }

  let cleaned = text.trim();

  const fenceRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = cleaned.match(fenceRegex);
  if (match && match[1] != null) {
    cleaned = match[1].trim();
  } else if (cleaned.startsWith("```")) {
    // Opening fence without a matched closing fence.
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  return cleaned;
}

/**
 * Best-effort salvage: return the substring from the first "{" to the last "}"
 * so prose-wrapped JSON can still be parsed. Lossy by nature - only call this
 * once a direct JSON.parse has failed.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1) return null;
  if (last > first) return text.slice(first, last + 1);
  // No closing brace at all -> take everything from the first "{" and let
  // repairTruncatedJson close it.
  return text.slice(first);
}

/**
 * Remove reasoning/thinking preambles some VLMs emit before the JSON
 * (Qwen "<think>...</think>", DeepSeek-style, etc.).
 * @param {string} text
 * @returns {string}
 */
function stripReasoningBlocks(text) {
  return String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?(?:thinking|reasoning|analysis)>/gi, "")
    .trim();
}

/** Drop trailing commas before } or ] - a very common model JSON defect. */
function removeTrailingCommas(jsonish) {
  return jsonish.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Best-effort repair of JSON truncated by the model's token limit: close any
 * strings/arrays/objects that were left open. Only used as a last resort.
 * @param {string} jsonish
 * @returns {string}
 */
function repairTruncatedJson(jsonish) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < jsonish.length; i++) {
    const c = jsonish[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  let out = jsonish;
  if (inStr) out += '"';
  // Tidy a dangling "key": or trailing comma at the cut point.
  out = out.replace(/,\s*$/, "").replace(/:\s*$/, ":null");
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return removeTrailingCommas(out);
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

  // If raw output is a string, parse defensively through escalating strategies:
  // exact -> de-fenced -> reasoning stripped -> trailing commas -> brace slice
  // -> truncation repair. Each is only reached because the previous one failed.
  if (typeof rawOutput === "string") {
    const base = stripReasoningBlocks(stripMarkdownFences(rawOutput));
    const sliced = extractJsonObject(base);
    const candidates = [
      base,
      removeTrailingCommas(base),
      sliced,
      sliced && removeTrailingCommas(sliced),
      sliced && repairTruncatedJson(sliced)
    ];

    let didParse = false;
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        parsed = JSON.parse(candidate);
        didParse = true;
        break;
      } catch {
        /* try next strategy */
      }
    }

    if (!didParse) {
      const excerpt = base.replace(/\s+/g, " ").slice(0, 200);
      return {
        provider,
        model,
        extractedAt: now,
        data: null,
        status: "failed",
        error: `Invalid JSON returned by model. Response began: ${excerpt}`
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

  // Some models reply with an error envelope (e.g. {"error":"image is blank"})
  // instead of the extraction shape. That is a failed extraction, not an empty
  // one — surface it so the popup shows the honest degraded state.
  const hasAnyExtractionField =
    typeof parsed.platform === "string" ||
    typeof parsed.contact_name === "string" ||
    typeof parsed.visible_time === "string" ||
    typeof parsed.date === "string" ||
    (Array.isArray(parsed.messages) && parsed.messages.length > 0);
  if (typeof parsed.error === "string" && parsed.error.trim() && !hasAnyExtractionField) {
    return {
      provider,
      model,
      extractedAt: now,
      data: null,
      status: "failed",
      error: parsed.error.trim()
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
    // Stop once the cap is reached - never build thousands of objects for a
    // hallucinating model just to slice them off afterwards.
    if (normalizedMessages.length >= MAX_MESSAGES_LIMIT) break;

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
