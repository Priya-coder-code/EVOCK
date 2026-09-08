/**
 * EVOCK — deterministic JSON canonicalisation (Role B, B1).
 *
 * An RFC 8785 / JCS-style subset, hand-written with zero dependencies. This is
 * the stable input to every hash in the evidence core.
 *
 * WHY THIS EXISTS
 * `JSON.stringify` preserves key insertion order. Role A builds the extraction
 * metadata in one order; the verifier rebuilds the manifest in another; the two
 * hashes differ; the product reports "MODIFICATION DETECTED" on untouched
 * evidence. A tool that cries tamper on its own records is worse than no tool.
 * Everything below exists to make that impossible.
 *
 * RULES
 * - Object keys are sorted lexicographically by UTF-16 code unit, recursively.
 * - No insignificant whitespace.
 * - Arrays keep their order. Order is meaningful (e.g. `messages`) and is never
 *   sorted. A hole in a sparse array and an explicit `undefined` item both
 *   become `null`, preserving length and every other item's position.
 * - `null` is preserved. A key whose value is `undefined` is dropped. A
 *   `function` or `symbol` value is an error, never a silent drop.
 * - Numbers: our schema is integers only. Integers serialise plainly and `-0`
 *   becomes `0`. A non-integer uses the shortest round-trip representation,
 *   never locale formatting. `NaN` and `Infinity` throw.
 * - Strings: standard JSON escaping. Non-ASCII is kept literal — emoji, RTL
 *   text and combining characters pass through unchanged, and no Unicode
 *   normalisation is applied, because normalising would silently alter
 *   preserved message text.
 *
 * HASHING CONTRACT — READ THIS BEFORE CALLING
 * This function returns a JavaScript string. Hashes are computed over BYTES:
 * callers must encode the result with `TextEncoder` (UTF-8) and hash those
 * bytes. Never hand a JS string straight to a digest function, and never run
 * `JSON.stringify` over the result again — either would reintroduce the
 * encoding ambiguity this module exists to remove. See `crypto/hash.js`.
 *
 * FAILURE MODE
 * Every rejection throws. Nothing is dropped, coerced or guessed, because a
 * value that quietly disappears here changes the hash without changing the
 * record. Errors name the path to the offending value so a preservation failure
 * can be diagnosed from a single log line.
 *
 * KNOWN LIMIT
 * Serialisation is recursive, so a pathologically deep object exhausts the call
 * stack and throws `RangeError`. The evidence schema is a fixed five levels
 * deep and Role A's `extraction/schema.js` normalises model output into that
 * shape, so this is unreachable in practice — and it fails closed rather than
 * emitting a wrong hash.
 */

/**
 * Serialise a value to its canonical JSON form.
 *
 * @param {any} value
 * @returns {string} deterministic JSON text
 * @throws {TypeError} on undefined at the top level, non-finite numbers,
 *   functions, symbols, bigints, circular references, or object types outside
 *   the evidence schema (Date, Map, Set, RegExp, typed arrays, class instances).
 */
export function canonicalize(value) {
  if (value === undefined) {
    throw new TypeError("canonicalize: cannot serialise `undefined` at the top level");
  }
  return serialise(value, new Set(), []);
}

/**
 * @param {any} value
 * @param {Set<object>} ancestors open objects on the current path, for cycle detection
 * @param {Array<string|number>} path location of `value`, for error messages
 * @returns {string}
 */
function serialise(value, ancestors, path) {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") return serialiseNumber(value, path);
  if (type === "string") return serialiseString(value);

  if (type === "function" || type === "symbol" || type === "bigint") {
    fail(`${type} values are not serialisable`, path);
  }

  if (type === "object") {
    if (ancestors.has(value)) {
      fail("circular reference", path);
    }
    ancestors.add(value);

    let out;
    if (Array.isArray(value)) {
      out = serialiseArray(value, ancestors, path);
    } else if (isPlainObject(value)) {
      out = serialiseObject(value, ancestors, path);
    } else {
      // A Date, Map, Set or class instance would otherwise serialise as `{}`,
      // silently emptying a hashed field. Fail loudly instead.
      fail(`unsupported object type ${Object.prototype.toString.call(value)}`, path);
    }

    ancestors.delete(value);
    return out;
  }

  fail(`unsupported value type ${type}`, path);
}

/**
 * Iteration is by index rather than `Array.prototype.map`, which skips holes:
 * mapping `[1, , 3]` leaves a hole in the result and `join(",")` renders it as
 * `[1,,3]`, which is not valid JSON.
 *
 * @param {any[]} value
 * @param {Set<object>} ancestors
 * @param {Array<string|number>} path
 * @returns {string}
 */
function serialiseArray(value, ancestors, path) {
  const items = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    items.push(item === undefined ? "null" : serialise(item, ancestors, [...path, i]));
  }
  return `[${items.join(",")}]`;
}

/**
 * @param {Record<string, any>} value
 * @param {Set<object>} ancestors
 * @param {Array<string|number>} path
 * @returns {string}
 */
function serialiseObject(value, ancestors, path) {
  // `Object.keys` returns integer-like keys first and the rest in insertion
  // order; the default `sort()` compares by UTF-16 code unit, which is exactly
  // the ordering we want and overrides both of those JS quirks.
  const keys = Object.keys(value).sort();

  const members = [];
  for (const key of keys) {
    // Read each property exactly once. Testing for `undefined` and then reading
    // again to serialise would invoke a getter twice, and hash the second value
    // while having tested the first.
    const item = value[key];
    if (item === undefined) continue;
    members.push(`${serialiseString(key)}:${serialise(item, ancestors, [...path, key])}`);
  }
  return `{${members.join(",")}}`;
}

/**
 * Standard JSON string escaping.
 *
 * `JSON.stringify` is safe here even though it is unsafe for objects: the
 * insertion-order problem applies only to object members, while its string
 * escaping is fully specified and deterministic. It keeps non-ASCII literal and
 * escapes lone surrogates into a well-formed form.
 *
 * @param {string} value
 * @returns {string}
 */
function serialiseString(value) {
  return JSON.stringify(value);
}

/**
 * @param {number} value
 * @param {Array<string|number>} path
 * @returns {string}
 */
function serialiseNumber(value, path) {
  if (!Number.isFinite(value)) {
    fail(`${String(value)} is not a serialisable number`, path);
  }
  // `String` implements the ECMAScript shortest round-trip number formatting and
  // is locale-independent. It also renders -0 as "0".
  return String(value);
}

/**
 * Records cross contexts in an extension — service worker, extension pages, and
 * IndexedDB structured clone — so a plain object may carry a foreign realm's
 * `Object.prototype` and would otherwise be rejected as an unsupported type.
 *
 * A foreign `Object.prototype` is recognisable: it is itself rootless and its
 * constructor is named "Object". `Date`, `Map` and class instances all fail that
 * test, because their prototypes inherit from an `Object.prototype` rather than
 * being one.
 *
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  if (proto === null || proto === Object.prototype) return true;
  return Object.getPrototypeOf(proto) === null && proto.constructor?.name === "Object";
}

/**
 * @param {string} message
 * @param {Array<string|number>} path
 * @returns {never}
 */
function fail(message, path) {
  throw new TypeError(`canonicalize: ${message} (at ${formatPath(path)})`);
}

/**
 * Render a value's location as `ai_derived_metadata.data.messages[0].text`.
 *
 * @param {Array<string|number>} path
 * @returns {string}
 */
function formatPath(path) {
  if (path.length === 0) return "<root>";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else out += out === "" ? segment : `.${segment}`;
  }
  return out;
}
