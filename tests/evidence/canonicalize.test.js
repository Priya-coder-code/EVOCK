/**
 * EVOCK — canonicalisation tests (Role B step 01, B1).
 *
 * `canonicalize` is the load-bearing wall of the evidence core: it is the
 * stable input to every hash in the system. A non-deterministic canonicaliser
 * makes verification report "MODIFICATION DETECTED" on untouched evidence, so
 * this file is deliberately heavier than the implementation it covers.
 */

import { describe, expect, it, vi } from "vitest";
import { canonicalize } from "../../extension/src/evidence/canonicalize.js";

/** All permutations of an array, in a deterministic order. */
function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

/**
 * Build the same logical object with a chosen key insertion order at both the
 * top level and one level down.
 */
function buildSample(outerOrder, innerOrder) {
  const innerValues = { a: [3, 4], b: 2, c: "x" };
  const inner = {};
  for (const key of innerOrder) inner[key] = innerValues[key];

  const outerValues = { 10: true, Mid: null, _x: "", alpha: inner, zeta: 1 };
  const outer = {};
  for (const key of outerOrder) outer[key] = outerValues[key];
  return outer;
}

const CANONICAL_SAMPLE =
  '{"10":true,"Mid":null,"_x":"","alpha":{"a":[3,4],"b":2,"c":"x"},"zeta":1}';

describe("canonicalize — key order invariance", () => {
  it("produces identical output for 10 different key insertion orders", () => {
    const outerOrders = permutations(["zeta", "alpha", "Mid", "_x", "10"]).slice(0, 10);
    const innerOrders = permutations(["c", "b", "a"]);

    const outputs = outerOrders.map((outerOrder, i) =>
      canonicalize(buildSample(outerOrder, innerOrders[i % innerOrders.length]))
    );

    expect(outputs).toHaveLength(10);
    expect(new Set(outputs).size).toBe(1);
  });

  it("sorts keys by UTF-16 code unit, not by locale or numeric position", () => {
    // "10" < "Mid" < "_x" < "alpha" < "zeta" by code unit (0x31 < 0x4D < 0x5F < 0x61 < 0x7A).
    expect(canonicalize(buildSample(["zeta", "_x", "Mid", "alpha", "10"], ["c", "a", "b"]))).toBe(
      CANONICAL_SAMPLE
    );
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize(buildSample(["10", "Mid", "_x", "alpha", "zeta"], ["a", "b", "c"]))).not.toContain(
      " "
    );
  });
});

describe("canonicalize — nesting", () => {
  it("handles objects inside arrays inside objects", () => {
    const value = {
      messages: [
        { text: "second", sender: "B" },
        { sender: "A", text: "first" }
      ],
      meta: { z: { y: [1, { x: null }] }, a: 1 }
    };

    expect(canonicalize(value)).toBe(
      '{"messages":[{"sender":"B","text":"second"},{"sender":"A","text":"first"}],' +
        '"meta":{"a":1,"z":{"y":[1,{"x":null}]}}}'
    );
  });
});

describe("canonicalize — null, missing and empty string", () => {
  it("distinguishes null from a missing key from an empty string", () => {
    const asNull = canonicalize({ a: null });
    const asMissing = canonicalize({});
    const asEmpty = canonicalize({ a: "" });

    expect(new Set([asNull, asMissing, asEmpty]).size).toBe(3);
    expect(asNull).toBe('{"a":null}');
    expect(asMissing).toBe("{}");
    expect(asEmpty).toBe('{"a":""}');
  });

  it("drops keys whose value is undefined", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("canonicalize — illegal values are errors, not silent drops", () => {
  it("throws on function values", () => {
    expect(() => canonicalize({ a: () => 1 })).toThrow(TypeError);
  });

  it("throws on symbol values", () => {
    expect(() => canonicalize({ a: Symbol("s") })).toThrow(TypeError);
  });

  it("throws on NaN and Infinity", () => {
    expect(() => canonicalize({ a: NaN })).toThrow(TypeError);
    expect(() => canonicalize({ a: Infinity })).toThrow(TypeError);
    expect(() => canonicalize({ a: -Infinity })).toThrow(TypeError);
  });

  it("throws on undefined at the top level", () => {
    expect(() => canonicalize(undefined)).toThrow(TypeError);
  });
});

describe("canonicalize — unicode", () => {
  const EMOJI = "👩‍⚖️";
  const RTL = "مرحبا";
  const COMBINING = "e\u0301"; // "e" + U+0301 combining acute
  const PRECOMPOSED = "\u00e9"; // single precomposed "e-acute" code point

  it("keeps emoji, RTL and combining characters literal (no \\u escaping)", () => {
    const out = canonicalize({ text: `${EMOJI} ${RTL} ${COMBINING}` });

    expect(out).toContain(EMOJI);
    expect(out).toContain(RTL);
    expect(out).toContain(COMBINING);
    expect(out).not.toContain("\\u");
  });

  it("produces byte-identical UTF-8 across repeated calls", () => {
    const value = { messages: [{ text: `${EMOJI}${RTL}${COMBINING}`, sender: null }] };
    const encoder = new TextEncoder();

    const first = encoder.encode(canonicalize(value));
    const second = encoder.encode(canonicalize(value));

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first.length).toBeGreaterThan(0);
  });

  it("does not unicode-normalise — decomposed and precomposed differ", () => {
    // Normalising would silently alter preserved message text.
    expect(canonicalize({ t: COMBINING })).not.toBe(canonicalize({ t: PRECOMPOSED }));
  });

  it("escapes quotes, backslashes and control characters", () => {
    expect(canonicalize({ t: 'a"b\\c\nd\te' })).toBe('{"t":"a\\"b\\\\c\\nd\\te"}');
  });
});

describe("canonicalize — array order is significant", () => {
  it("produces different output for reordered arrays", () => {
    expect(canonicalize([{ s: "a" }, { s: "b" }])).not.toBe(canonicalize([{ s: "b" }, { s: "a" }]));
  });

  it("never sorts array items", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("canonicalize — determinism across reload", () => {
  it("returns the same string twice in one process and after a module reset", async () => {
    const value = buildSample(["alpha", "zeta", "10", "_x", "Mid"], ["b", "c", "a"]);

    const first = canonicalize(value);
    const second = canonicalize(value);

    vi.resetModules();
    const reloaded = await import("../../extension/src/evidence/canonicalize.js");
    const third = reloaded.canonicalize(value);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).toBe(CANONICAL_SAMPLE);
  });
});

describe("canonicalize — numbers", () => {
  it("serialises negative zero as 0", () => {
    expect(canonicalize({ n: -0 })).toBe('{"n":0}');
    expect(canonicalize({ n: -0 })).not.toContain("-0");
  });

  it("round-trips large safe integers", () => {
    expect(canonicalize({ n: Number.MAX_SAFE_INTEGER })).toBe('{"n":9007199254740991}');
    expect(JSON.parse(canonicalize({ n: Number.MAX_SAFE_INTEGER })).n).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("uses the shortest round-trip form for non-integers", () => {
    expect(canonicalize({ n: 0.1 })).toBe('{"n":0.1}');
    expect(JSON.parse(canonicalize({ n: 1.5 })).n).toBe(1.5);
  });
});

describe("canonicalize — output is always valid JSON", () => {
  // The single strongest property this module has: whatever goes in, what comes
  // out must parse. This is the assertion that catches malformed emission.
  const CASES = [
    null,
    true,
    7,
    "hi",
    {},
    [],
    [1, , 3], // eslint-disable-line no-sparse-arrays
    new Array(3),
    { a: [, 2] }, // eslint-disable-line no-sparse-arrays
    { a: undefined, b: 1 },
    [undefined, 2],
    { messages: [{ text: "x", sender: null }], meta: { z: 1, a: [true, false] } }
  ];

  it.each(CASES.map((value, i) => [i, value]))("case %i parses as JSON", (_i, value) => {
    expect(() => JSON.parse(canonicalize(value))).not.toThrow();
  });

  it("round-trips through JSON.parse to an equal value", () => {
    const value = { b: [1, { d: null, c: "x" }], a: "" };
    expect(JSON.parse(canonicalize(value))).toEqual(value);
  });
});

describe("canonicalize — sparse arrays", () => {
  it("renders holes as null rather than emitting invalid JSON", () => {
    // Array.prototype.map skips holes, which would emit "[1,,3]".
    expect(canonicalize([1, , 3])).toBe("[1,null,3]"); // eslint-disable-line no-sparse-arrays
    expect(canonicalize(new Array(3))).toBe("[null,null,null]");
  });

  it("treats a hole and an explicit undefined identically", () => {
    expect(canonicalize([1, , 3])).toBe(canonicalize([1, undefined, 3])); // eslint-disable-line no-sparse-arrays
  });

  it("preserves array length and item positions", () => {
    expect(JSON.parse(canonicalize([1, , 3]))).toHaveLength(3); // eslint-disable-line no-sparse-arrays
  });
});

describe("canonicalize — property reads", () => {
  it("reads each property exactly once", () => {
    // Reading twice (once to test for undefined, once to serialise) would hash a
    // different value than the one tested whenever the property is a getter.
    let reads = 0;
    const value = {
      get a() {
        reads++;
        return 1;
      },
      b: 2
    };

    canonicalize(value);
    expect(reads).toBe(1);
  });

  it("serialises the value it actually read", () => {
    let n = 0;
    const value = {
      get v() {
        return ++n;
      }
    };
    expect(canonicalize(value)).toBe('{"v":1}');
  });
});

describe("canonicalize — object types outside the evidence schema", () => {
  it("throws rather than silently serialising them as {}", () => {
    expect(() => canonicalize({ d: new Date(0) })).toThrow(TypeError);
    expect(() => canonicalize({ m: new Map() })).toThrow(TypeError);
    expect(() => canonicalize({ s: new Set() })).toThrow(TypeError);
    expect(() => canonicalize({ r: /x/ })).toThrow(TypeError);
    expect(() => canonicalize({ n: new Number(5) })).toThrow(TypeError);
    expect(() => canonicalize({ i: new (class Foo {})() })).toThrow(TypeError);
  });

  it("accepts null-prototype objects", () => {
    const value = Object.create(null);
    value.b = 2;
    value.a = 1;
    expect(canonicalize(value)).toBe('{"a":1,"b":2}');
  });

  it("accepts a plain object from another realm", async () => {
    // Records cross contexts in an extension (service worker, pages, IndexedDB
    // structured clone). A foreign plain object must not be mistaken for a Date.
    const vm = await import("node:vm");
    const foreign = vm.runInNewContext("({ b: 2, a: 1 })");
    expect(canonicalize(foreign)).toBe('{"a":1,"b":2}');
  });

  it("still rejects a Date from another realm", async () => {
    const vm = await import("node:vm");
    const foreignDate = vm.runInNewContext("new Date(0)");
    expect(() => canonicalize({ d: foreignDate })).toThrow(TypeError);
  });
});

describe("canonicalize — references", () => {
  it("throws on a circular reference instead of overflowing the stack", () => {
    const value = { a: 1 };
    value.self = value;
    expect(() => canonicalize(value)).toThrow(TypeError);
  });

  it("throws on a circular reference through an array", () => {
    const value = [];
    value.push(value);
    expect(() => canonicalize(value)).toThrow(TypeError);
  });

  it("allows the same object to appear twice as siblings", () => {
    const shared = { x: 1 };
    expect(canonicalize({ b: shared, a: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });
});

describe("canonicalize — top-level primitives", () => {
  it("serialises primitives handed in directly", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(7)).toBe("7");
    expect(canonicalize("hi")).toBe('"hi"');
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize({})).toBe("{}");
  });
});

describe("canonicalize — error messages", () => {
  it("names the path to the offending value", () => {
    const manifest = {
      ai_derived_metadata: { data: { messages: [{ sender: "A", text: () => "x" }] } }
    };

    expect(() => canonicalize(manifest)).toThrow(
      /at ai_derived_metadata\.data\.messages\[0\]\.text/
    );
  });

  it("names the root for a top-level failure", () => {
    expect(() => canonicalize(NaN)).toThrow(/at <root>/);
  });

  it("names the index of a bad array item", () => {
    expect(() => canonicalize({ messages: [1, Infinity] })).toThrow(/at messages\[1\]/);
  });

  it("names the path of a circular reference", () => {
    const value = { a: { b: {} } };
    value.a.b.loop = value;
    expect(() => canonicalize(value)).toThrow(/at a\.b\.loop/);
  });
});
