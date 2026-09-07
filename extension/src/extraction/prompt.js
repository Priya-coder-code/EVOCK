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
export const EXTRACTION_SYSTEM_PROMPT = `You are a digital evidence extraction assistant for EVOCK. Inspect the provided screenshot and extract ONLY information visibly present in it.

RULES:
1. Extract ONLY what you can actually SEE in the screenshot. Never guess or invent.
2. If something is not visible or unreadable, use null — never "N/A", "none", or placeholder text.
3. Preserve message text EXACTLY as written. Do not fix spelling, grammar, or rephrase.
4. Do NOT classify or judge content (no "threatening", "harassing", etc.).
5. Return ONLY valid JSON. No markdown fences, no explanations, no preamble.
6. messages must be an array of objects. If you see no messages, return an empty array [].

OUTPUT JSON FORMAT (return exactly this structure):
{
  "platform": "WhatsApp",
  "contact_name": "Mr. ABC B",
  "messages": [
    {
      "sender": "Mr. ABC B",
      "text": "Don't try to hide.....",
      "visible_timestamp": "11:28 PM",
      "type": "incoming"
    },
    {
      "sender": "You",
      "text": "I know where you live",
      "visible_timestamp": "11:29 PM",
      "type": "outgoing"
    }
  ],
  "visible_time": "11:29 PM",
  "date": "1 September 2026"
}

Rules for each field:
- platform: the app name visible in the screenshot (WhatsApp, Instagram, Telegram, X, etc.)
- contact_name: the name shown in the chat header or title bar
- messages: array of EVERY visible message bubble, each with sender (who sent it), text (exact visible text), visible_timestamp (if shown on the bubble), type ("incoming" = received, "outgoing" = sent by user, "unknown" = cannot determine)
- visible_time: the time shown in the screenshot's top status bar
- date: the date visible in the screenshot (day separator, header, etc.)`;

/**
 * User instruction prompt accompanying the screenshot.
 */
export const EXTRACTION_USER_PROMPT = `Look at this screenshot carefully. Inspect every part of the image:
- Check the top bar for app name, time, and date.
- Check the chat header for the contact or group name.
- Read every visible message bubble — extract the sender name and exact text.
- Note timestamps on messages if visible.
- Determine if each message is incoming (received) or outgoing (sent by the device owner).

Return ONLY the JSON object. Do not add any text before or after the JSON.`;

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
