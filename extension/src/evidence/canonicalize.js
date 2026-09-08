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
 *   sorted.
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
  return serialise(value, new Set());
}

/**
 * @param {any} value
 * @param {Set<object>} ancestors open objects on the current path, for cycle detection
 * @returns {string}
 */
function serialise(value, ancestors) {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") return serialiseNumber(value);
  if (type === "string") return serialiseString(value);

  if (type === "function" || type === "symbol" || type === "bigint") {
    // Explicitly an error rather than a silent drop: a field that vanishes
    // during canonicalisation changes the hash without changing the record.
    throw new TypeError(`canonicalize: ${type} values are not serialisable`);
  }

  if (type === "object") {
    if (ancestors.has(value)) {
      throw new TypeError("canonicalize: circular reference");
    }
    ancestors.add(value);

    let out;
    if (Array.isArray(value)) {
      out = serialiseArray(value, ancestors);
    } else if (isPlainObject(value)) {
      out = serialiseObject(value, ancestors);
    } else {
      // A Date, Map, Set or class instance would otherwise serialise as `{}`,
      // silently emptying a hashed field. Fail loudly instead.
      throw new TypeError(
        `canonicalize: unsupported object type ${Object.prototype.toString.call(value)}`
      );
    }

    ancestors.delete(value);
    return out;
  }

  throw new TypeError(`canonicalize: unsupported value type ${type}`);
}

/**
 * Arrays keep their order. An `undefined` item becomes `null` so the array's
 * length and the position of every other item are preserved.
 *
 * @param {any[]} value
 * @param {Set<object>} ancestors
 * @returns {string}
 */
function serialiseArray(value, ancestors) {
  const items = value.map((item) =>
    item === undefined ? "null" : serialise(item, ancestors)
  );
  return `[${items.join(",")}]`;
}

/**
 * @param {Record<string, any>} value
 * @param {Set<object>} ancestors
 * @returns {string}
 */
function serialiseObject(value, ancestors) {
  // `Object.keys` returns integer-like keys first and the rest in insertion
  // order; the default `sort()` compares by UTF-16 code unit, which is exactly
  // the ordering we want and overrides both of those JS quirks.
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();

  const members = keys.map(
    (key) => `${serialiseString(key)}:${serialise(value[key], ancestors)}`
  );
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
 * @returns {string}
 */
function serialiseNumber(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`canonicalize: ${String(value)} is not a serialisable number`);
  }
  // `String` implements the ECMAScript shortest round-trip number formatting and
  // is locale-independent. It also renders -0 as "0".
  return String(value);
}

/**
 * @param {any} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
