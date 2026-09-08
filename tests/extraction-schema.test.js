/**
 * EVOCK - Unit Tests for Milestone A5 (Prompt & Schema Validation)
 *
 * Tests all required validation & prompt edge cases:
 * - valid JSON object
 * - valid extraction with multiple messages
 * - missing optional fields
 * - null fields
 * - Markdown ```json fences
 * - invalid JSON
 * - completely malformed model output
 * - unknown extra keys
 * - messages not being an array
 * - invalid message field types
 * - invalid message type becoming "unknown"
 * - more than 50 messages being capped
 * - whitespace trimming
 * - message text is not rewritten or paraphrased
 */

export function runTests(validateAndNormalizeExtraction, EXTRACTION_SYSTEM_PROMPT, stripMarkdownFences) {
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || "Assertion failed");
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message || "Assertion failed"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  // 1. Valid JSON object
  test("1. Valid JSON object with all fields", () => {
    const input = {
      platform: "WhatsApp",
      contact_name: "Alice Smith",
      messages: [
        {
          sender: "Alice Smith",
          text: "Hello, this is a test message.",
          visible_timestamp: "10:15 AM",
          type: "incoming"
        }
      ],
      visible_time: "10:15 AM",
      date: "2026-09-01"
    };

    const res = validateAndNormalizeExtraction(input, { provider: "vision", model: "test-model" });
    assertEqual(res.status, "ok", "Status should be ok");
    assertEqual(res.error, null, "Error should be null");
    assertEqual(res.data.platform, "WhatsApp", "Platform matches");
    assertEqual(res.data.contact_name, "Alice Smith", "Contact matches");
    assertEqual(res.data.messages.length, 1, "Messages length 1");
    assertEqual(res.data.messages[0].type, "incoming", "Type is incoming");
  });

  // 2. Valid extraction with multiple messages
  test("2. Valid extraction with multiple messages", () => {
    const input = {
      platform: "Instagram",
      contact_name: "Bob",
      messages: [
        { sender: "Bob", text: "First message", visible_timestamp: "11:00", type: "incoming" },
        { sender: "Me", text: "Second message", visible_timestamp: "11:01", type: "outgoing" },
        { sender: null, text: "Third message", visible_timestamp: null, type: "unknown" }
      ],
      visible_time: "11:01",
      date: null
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status should be ok");
    assertEqual(res.data.messages.length, 3, "Should have 3 messages");
    assertEqual(res.data.messages[1].type, "outgoing", "Message 2 type outgoing");
  });

  // 3. Missing optional fields
  test("3. Missing optional fields become null", () => {
    const input = {
      messages: []
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status should be ok");
    assertEqual(res.data.platform, null, "Missing platform should be null");
    assertEqual(res.data.contact_name, null, "Missing contact_name should be null");
    assertEqual(res.data.visible_time, null, "Missing visible_time should be null");
    assertEqual(res.data.date, null, "Missing date should be null");
  });

  // 4. Null fields
  test("4. Explicit null fields are preserved cleanly", () => {
    const input = {
      platform: null,
      contact_name: null,
      messages: [
        { sender: null, text: null, visible_timestamp: null, type: null }
      ],
      visible_time: null,
      date: null
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status should be ok");
    assertEqual(res.data.platform, null, "Platform null");
    assertEqual(res.data.messages[0].sender, null, "Sender null");
    assertEqual(res.data.messages[0].type, "unknown", "Null type becomes unknown");
  });

  // 5. Markdown ```json fences
  test("5. Markdown ```json code block fences are stripped", () => {
    const input = "```json\n{\n  \"platform\": \"Signal\",\n  \"contact_name\": \"Contact 1\",\n  \"messages\": []\n}\n```";

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status should be ok");
    assertEqual(res.data.platform, "Signal", "Platform extracted from markdown fence");
  });

  // 6. Invalid JSON string
  test("6. Invalid JSON string returns clean failed status", () => {
    const input = "{ broken JSON: missing quotes and brackets";

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "failed", "Status should be failed");
    assertEqual(res.data, null, "Data should be null");
    assert(res.error.includes("Invalid JSON"), "Error describes invalid JSON");
  });

  // 7. Completely malformed model output
  test("7. Malformed output (non-object) returns clean failed status", () => {
    const inputs = [
      "I am a helpful assistant and here is the text",
      42,
      true,
      ["an", "array", "not", "object"],
      null
    ];

    for (const raw of inputs) {
      const res = validateAndNormalizeExtraction(raw);
      assertEqual(res.status, "failed", `Status should be failed for ${typeof raw}`);
      assertEqual(res.data, null, "Data must be null on failure");
      assert(typeof res.error === "string", "Error should be a readable explanation");
    }
  });

  // 8. Unknown extra keys are dropped
  test("8. Unknown extra top-level and message keys are ignored/dropped", () => {
    const input = {
      platform: "X",
      extra_junk_field: "drop me",
      model_hallucination: 12345,
      messages: [
        {
          sender: "Sender",
          text: "Message",
          visible_timestamp: "12:00",
          type: "incoming",
          extra_message_key: "should be ignored",
          message_id: 999
        }
      ]
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status ok");
    assert(!("extra_junk_field" in res.data), "extra_junk_field dropped");
    assert(!("model_hallucination" in res.data), "model_hallucination dropped");
    assert(!("extra_message_key" in res.data.messages[0]), "extra_message_key dropped");
    assert(!("message_id" in res.data.messages[0]), "message_id dropped");
  });

  // 9. Messages not being an array
  test("9. Non-array messages field is coerced to empty array", () => {
    const input = {
      platform: "Web",
      messages: "This is a single string not an array"
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status should be ok");
    assert(Array.isArray(res.data.messages), "Messages must be an array");
    assertEqual(res.data.messages.length, 0, "Messages coerced to empty array");
  });

  // 10. Invalid message field types
  test("10. Invalid message field types become null instead of casting", () => {
    const input = {
      messages: [
        {
          sender: 98765, // Number instead of string
          text: { nested: "object" }, // Object instead of string
          visible_timestamp: false, // Boolean instead of string
          type: "incoming"
        }
      ]
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status ok");
    assertEqual(res.data.messages[0].sender, null, "Number sender becomes null");
    assertEqual(res.data.messages[0].text, null, "Object text becomes null");
    assertEqual(res.data.messages[0].visible_timestamp, null, "Boolean timestamp becomes null");
  });

  // 11. Invalid message type becoming 'unknown'
  test("11. Invalid message type string becomes 'unknown'", () => {
    const input = {
      messages: [
        { sender: "A", text: "T1", visible_timestamp: "1", type: "SENT_BY_USER" },
        { sender: "B", text: "T2", visible_timestamp: "2", type: "received" },
        { sender: "C", text: "T3", visible_timestamp: "3", type: 42 }
      ]
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status ok");
    assertEqual(res.data.messages[0].type, "unknown", "SENT_BY_USER becomes unknown");
    assertEqual(res.data.messages[1].type, "unknown", "received becomes unknown");
    assertEqual(res.data.messages[2].type, "unknown", "number type becomes unknown");
  });

  // 12. More than 50 messages being capped
  test("12. Excessive messages list is capped to 50", () => {
    const manyMessages = [];
    for (let i = 0; i < 85; i++) {
      manyMessages.push({
        sender: `Sender ${i}`,
        text: `Message number ${i}`,
        visible_timestamp: "12:00",
        type: "incoming"
      });
    }

    const input = { messages: manyMessages };
    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status ok");
    assertEqual(res.data.messages.length, 50, "Capped to 50 messages");
    assertEqual(res.data.messages[0].text, "Message number 0", "First message preserved");
    assertEqual(res.data.messages[49].text, "Message number 49", "50th message preserved");
  });

  // 13. Whitespace trimming
  test("13. Surrounding whitespace is trimmed from string fields", () => {
    const input = {
      platform: "   WhatsApp   ",
      contact_name: "  Jane Doe  ",
      visible_time: "  08:30 PM  ",
      date: "  2026-09-07  ",
      messages: [
        {
          sender: "  Jane Doe  ",
          text: "   Hello there!   ",
          visible_timestamp: "  08:30 PM  ",
          type: " incoming "
        }
      ]
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(res.status, "ok", "Status ok");
    assertEqual(res.data.platform, "WhatsApp", "Platform trimmed");
    assertEqual(res.data.contact_name, "Jane Doe", "Contact trimmed");
    assertEqual(res.data.visible_time, "08:30 PM", "Visible time trimmed");
    assertEqual(res.data.date, "2026-09-07", "Date trimmed");
    assertEqual(res.data.messages[0].sender, "Jane Doe", "Sender trimmed");
    assertEqual(res.data.messages[0].text, "Hello there!", "Text trimmed");
    assertEqual(res.data.messages[0].visible_timestamp, "08:30 PM", "Timestamp trimmed");
    assertEqual(res.data.messages[0].type, "incoming", "Type trimmed");
  });

  // 14. Message text is NOT rewritten or paraphrased
  test("14. Raw message text interior content is faithfully preserved", () => {
    const verbatimEvidence = "  U R GONNA REGRET THIS!!! yOu hear me?!?? #abuse  ";
    const input = {
      messages: [
        {
          sender: "Stalker",
          text: verbatimEvidence,
          visible_timestamp: "12:00 AM",
          type: "incoming"
        }
      ]
    };

    const res = validateAndNormalizeExtraction(input);
    assertEqual(
      res.data.messages[0].text,
      "U R GONNA REGRET THIS!!! yOu hear me?!?? #abuse",
      "Exact casing, punctuation, and misspellings must be preserved"
    );
  });

  // 15. Prompt carries its load-bearing invariants (regression guard)
  test("15. system prompt states the ordering, alignment and null rules", () => {
    const p = String(EXTRACTION_SYSTEM_PROMPT).toLowerCase();
    assert(p.includes("top") && p.includes("bottom"), "must state top-to-bottom order");
    assert(p.includes("chronological"), "must state chronological order");
    assert(p.includes("left") && p.includes("right"), "must define left/right alignment");
    assert(p.includes("incoming") && p.includes("outgoing"), "must name both message types");
    assert(p.includes("null"), "must instruct null for non-visible fields");
    assert(p.includes("verbatim") || p.includes("exactly"), "must require verbatim text");
    assert(p.includes("json"), "must require JSON output");
  });

  // 16. Prose-wrapped JSON is salvaged; a stray brace in text does not truncate
  test("16. salvage parses prose-wrapped JSON without corrupting brace-in-string", () => {
    const wrapped = 'Sure! Here is the data:\n{"platform":"X","messages":[]}\nHope that helps.';
    const r1 = validateAndNormalizeExtraction(wrapped);
    assertEqual(r1.status, "ok", "prose-wrapped JSON should parse");
    assertEqual(r1.data.platform, "X", "platform extracted from wrapped JSON");

    const braceInText = '{"platform":"WhatsApp","contact_name":null,"messages":[' +
      '{"sender":"A","text":"use } wisely","visible_timestamp":null,"type":"incoming"}],' +
      '"visible_time":null,"date":null}';
    const r2 = validateAndNormalizeExtraction(braceInText);
    assertEqual(r2.status, "ok", "valid JSON with a brace inside a string still parses");
    assertEqual(r2.data.messages[0].text, "use } wisely", "brace-in-string text preserved intact");
  });

  // 17. "unknown" / "-" are kept as real values, not nulled
  test("17. narrow placeholder normalisation keeps 'unknown' and '-'", () => {
    const r = validateAndNormalizeExtraction({
      platform: "unknown", contact_name: "-", visible_time: "N/A", date: "none", messages: []
    });
    assertEqual(r.status, "ok", "status ok");
    assertEqual(r.data.platform, "unknown", "'unknown' is a real visible value");
    assertEqual(r.data.contact_name, "-", "'-' is a real visible value");
    assertEqual(r.data.visible_time, null, "'N/A' still normalises to null");
    assertEqual(r.data.date, null, "'none' still normalises to null");
  });

  return results;
}
