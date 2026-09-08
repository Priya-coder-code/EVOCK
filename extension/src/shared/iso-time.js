/**
 * EVOCK — ISO-8601 timestamp with local offset (Role B shared util).
 *
 * The one format used everywhere a wall-clock time is recorded: matches what
 * Role A's capture.js emits (e.g. "2026-09-07T22:30:15+05:30"), so device
 * capture time, signed_at and verified_at all read the same way.
 */

/**
 * @param {Date} [date]
 * @returns {string} ISO-8601 with a signed UTC offset
 */
export function nowIso(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMinutes);

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`
  );
}
