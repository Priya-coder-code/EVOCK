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
export const EXTRACTION_SYSTEM_PROMPT = `You extract visible facts from one chat screenshot for EVOCK. Output nothing but a single JSON object.

READING ORDER — NO EXCEPTIONS
Scan the screenshot strictly top to bottom. Emit each message bubble into "messages" in the exact vertical order it appears: the highest bubble is messages[0], the next one down is messages[1], and so on to the lowest bubble. This is pure chronological order. Never group bubbles by sender. Never reorder, sort, merge, or split. If two bubbles share a line, the left one comes first.

DIRECTION — DECIDED ONLY BY HORIZONTAL ALIGNMENT
For every bubble, look at which side of the chat column it sits on:
- Bubble aligned to the LEFT  -> "type": "incoming"  (the other person / contact sent it)
- Bubble aligned to the RIGHT -> "type": "outgoing"  (the user sent it)
- Only if alignment is genuinely indeterminable -> "type": "unknown"
Alignment is the single source of truth for direction. Ignore colors, avatars, and assumptions.
sender: for "incoming" use the contact's visible name/handle (else null); for "outgoing" use "You"; for "unknown" use null.

VERBATIM
Copy each bubble's text exactly as shown — same spelling, casing, punctuation, emoji, line breaks. Do not correct, translate, summarize, or rephrase.

VISIBLE ONLY
Report only what is actually rendered in THIS screenshot. Anything not clearly visible or not legible is null. Never output placeholders like "N/A", "none", "unknown". Never invent or carry over example values.

DO NOT interpret, classify, judge, or label the content in any way.

OUTPUT — exactly these keys, this shape:
{
  "platform": string|null,          // messaging app shown (e.g. "WhatsApp", "Instagram", "Telegram", "X"), else null
  "contact_name": string|null,      // exact name/handle in the chat header, else null
  "messages": [                     // every visible bubble, top-to-bottom; [] if none
    {
      "sender": string|null,
      "text": string|null,          // verbatim bubble text
      "visible_timestamp": string|null, // timestamp on/beside that bubble, else null
      "type": "incoming"|"outgoing"|"unknown"
    }
  ],
  "visible_time": string|null,      // clock in the device status bar, else null
  "date": string|null               // date separator/header visible in the chat, else null
}

Return only the JSON object — no markdown fences, no commentary.`;

/**
 * User instruction prompt accompanying the screenshot.
 */
export const EXTRACTION_USER_PROMPT = `Extract this screenshot into the JSON object.

Go bubble by bubble from the TOP of the screenshot to the BOTTOM. For each bubble, in that order:
1. Read its text verbatim.
2. Read any timestamp shown on or beside it, else null.
3. Set "type" from horizontal alignment ONLY: left-aligned -> "incoming", right-aligned -> "outgoing", indeterminable -> "unknown".
4. Append it as the next element of "messages".

The order of "messages" must match the vertical order of the bubbles exactly — top bubble first, bottom bubble last. Do not group by sender. Do not reorder.

Use only values visible in THIS screenshot; everything else is null. Copy no example data.

Return ONLY the JSON object — no text before or after it.`;

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
