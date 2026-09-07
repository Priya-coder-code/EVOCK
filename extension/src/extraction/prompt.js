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

TWO CRITICAL RULES:

1) CHRONOLOGICAL ORDER: The messages array MUST list messages in the EXACT order they appear top-to-bottom in the screenshot. If the chat shows:
   - Message A (other person)
   - Message B (you)
   - Message C (other person)
   Then messages[] MUST be [A, B, C] — NOT [A, C, B]. NEVER group by sender. NEVER sort.

2) CORRECT DIRECTION: Use the visual bubble position to determine type:
   - Messages on the LEFT side or with the other person's name = "incoming"
   - Messages on the RIGHT side or with "You" label = "outgoing"
   In most chat apps, the other person's messages appear on the LEFT and your messages on the RIGHT. Use this to assign the correct type.

RULES:
1. Extract ONLY what you can actually SEE in the screenshot. Never guess or invent.
2. If something is not visible or unreadable, use null — never "N/A", "none", or placeholder text.
3. Preserve message text EXACTLY as written. Do not fix spelling, grammar, or rephrase.
4. Do NOT classify or judge content (no "threatening", "harassing", etc.).
5. Return ONLY valid JSON. No markdown fences, no explanations, no preamble.
6. messages must be an array of objects in top-to-bottom visual order. If you see no messages, return an empty array [].

OUTPUT JSON FORMAT — note how messages alternate between incoming and outgoing in array order:
{
  "platform": "WhatsApp",
  "contact_name": "Mr. ABC B",
  "messages": [
    { "sender": "Mr. ABC B", "text": "Hi", "visible_timestamp": "11:27 PM", "type": "incoming" },
    { "sender": "You", "text": "Hello", "visible_timestamp": "11:28 PM", "type": "outgoing" },
    { "sender": "Mr. ABC B", "text": "How are you?", "visible_timestamp": "11:29 PM", "type": "incoming" },
    { "sender": "You", "text": "I'm good", "visible_timestamp": "11:30 PM", "type": "outgoing" }
  ],
  "visible_time": "11:30 PM",
  "date": "1 September 2026"
}

Notice: The array alternates incoming → outgoing → incoming → outgoing, matching the visual conversation order. It is NOT grouped as [all incoming, then all outgoing].

Rules for each field:
- platform: the app name visible in the screenshot (WhatsApp, Instagram, Telegram, X, etc.)
- contact_name: the name shown in the chat header or title bar
- messages: array of EVERY visible message bubble in top-to-bottom order, each with: sender (who sent it — use the contact name for their messages, "You" for the user's), text (exact visible text), visible_timestamp (if shown on the bubble), type ("incoming" = left-side/other person message, "outgoing" = right-side/user message, "unknown" = cannot determine)
- visible_time: the time shown in the screenshot's top status bar
- date: the date visible in the screenshot (day separator, header, etc.)`;

/**
 * User instruction prompt accompanying the screenshot.
 */
export const EXTRACTION_USER_PROMPT = `Look at this screenshot carefully and read every message bubble.

For EACH message bubble in the screenshot, from top to bottom:
1. Read the sender name shown on or near the bubble.
2. Read the exact message text.
3. Note any visible timestamp on or near the bubble.
4. Determine direction: Is this bubble on the LEFT side (other person = incoming) or RIGHT side (you = outgoing)?
5. Add it as the next element in the messages array.

The messages array must preserve the exact conversation order. If the screenshot shows:
  ABC: Hi (left) → You: Hello (right) → ABC: How are you? (left)
Then messages[] = [ABC's Hi, You's Hello, ABC's How are you?]

Do NOT group by sender. Do NOT reorder. Do NOT create separate arrays.

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
