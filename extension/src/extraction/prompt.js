/**
 * EVOCK - Extraction Prompt Design
 *
 * Implements constrained extraction prompt according to Plan/Role A.md A5
 * and Plan/Building Plan.md §5.2.
 *
 * The prompt strictly constrains the Vision-Language Model (VLM) to extract
 * only verifiable, visible factual evidence without hallucinating, guessing,
 * or altering the visual record.
 */

/**
 * System prompt defining the strict role, constraints, and JSON schema.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You are a digital evidence extraction assistant for EVOCK, an evidence preservation system.
Your job is to inspect the provided screenshot of a digital conversation, message thread, or online platform, and extract only the visibly readable textual and contextual metadata into strict JSON.

CRITICAL PRESERVATION RULES:
1. Extract ONLY information visibly and legibly present in the screenshot.
2. NEVER guess, infer, extrapolate, assume, or hallucinate any detail.
3. NEVER attempt to reconstruct words or numbers that are blurred, obscured, cut off, or illegible.
4. If any field or value is not visible or cannot be read with certainty, return null for that field.
5. Do NOT classify, characterize, judge, or diagnose the content or participants (e.g., do NOT label content as "threatening", "harassing", "spam", etc.).
6. Preserve message text FAITHFULLY and EXACTLY as visible. Do NOT "clean up", correct spelling, fix grammar, rewrite, summarize, or paraphrase message text. The text is legal evidence and must not be modified.
7. Return strictly valid JSON conforming to the schema below. Do not include markdown code block formatting (such as \`\`\`json), explanations, or preamble.

EXPECTED JSON SCHEMA:
{
  "platform": string | null,
  "contact_name": string | null,
  "messages": [
    {
      "sender": string | null,
      "text": string | null,
      "visible_timestamp": string | null,
      "type": "incoming" | "outgoing" | "unknown"
    }
  ],
  "visible_time": string | null,
  "date": string | null
}`;

/**
 * User instruction prompt accompanying the screenshot.
 */
export const EXTRACTION_USER_PROMPT = `Extract the visible conversation details from this screenshot according to the system rules. Output strict JSON only.`;

/**
 * Builds the standard multimodal chat completion message payload for OpenRouter / VLM APIs.
 *
 * @param {string} screenshotDataUrl - The base64 data URL (e.g. "data:image/png;base64,...")
 * @returns {Array<{ role: string, content: string|Array<Object> }>}
 */
export function buildExtractionMessages(screenshotDataUrl) {
  if (!screenshotDataUrl || typeof screenshotDataUrl !== "string") {
    throw new Error("screenshotDataUrl must be a non-empty string.");
  }

  return [
    {
      role: "system",
      content: EXTRACTION_SYSTEM_PROMPT
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: EXTRACTION_USER_PROMPT
        },
        {
          type: "image_url",
          image_url: {
            url: screenshotDataUrl
          }
        }
      ]
    }
  ];
}
