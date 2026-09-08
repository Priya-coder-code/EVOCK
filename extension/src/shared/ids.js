/**
 * EVOCK — evidence identifier allocation (Role B, B6).
 *
 * Evidence ids are a zero-padded monotonic sequence: NK-0001, NK-0002, … The
 * counter lives in the `settings` store, and it is read and incremented inside
 * the caller's own transaction so two captures racing through `vault-repo.put`
 * cannot be handed the same id.
 *
 * Ids are never reused. `remove()` deletes a record but does not roll the
 * counter back, so a gap in the sequence is normal and expected.
 */

import { requestToPromise, STORE_SETTINGS } from "../storage/db.js";

/** `settings` key holding the last-allocated evidence number. */
export const EVIDENCE_COUNTER_KEY = "evidence_counter";

const ID_PREFIX = "NK-";
const ID_PAD_WIDTH = 4;

/**
 * Format an evidence number as an id string.
 *
 * Past 9999 the number simply grows to five digits (NK-10000). Ordering by id
 * string then no longer matches numeric order, which is why the vault sorts by
 * `created_at`, not by id — the id is an identifier, not a sort key.
 *
 * @param {number} n a positive integer
 * @returns {string}
 */
export function formatEvidenceId(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`formatEvidenceId: expected a positive integer, got ${n}`);
  }
  return ID_PREFIX + String(n).padStart(ID_PAD_WIDTH, "0");
}

/**
 * Allocate the next evidence id within the caller's transaction.
 *
 * The transaction MUST already have `settings` in its scope and be `readwrite`.
 * Callers pass the same transaction they use for the record write, so the
 * counter bump and the record insert commit together or not at all.
 *
 * @param {IDBTransaction} tx a readwrite transaction whose scope includes `settings`
 * @returns {Promise<string>} e.g. "NK-0001"
 */
export async function nextEvidenceId(tx) {
  if (!tx || typeof tx.objectStore !== "function") {
    throw new TypeError("nextEvidenceId: expected an open IDBTransaction");
  }

  const settings = tx.objectStore(STORE_SETTINGS);
  const row = await requestToPromise(settings.get(EVIDENCE_COUNTER_KEY));

  const current = row?.value ?? 0;
  if (!Number.isInteger(current) || current < 0) {
    // Refuse to guess. Resetting a corrupt counter to 0 would hand out ids that
    // already belong to stored records.
    throw new Error(
      `nextEvidenceId: the "${EVIDENCE_COUNTER_KEY}" setting is corrupt (${JSON.stringify(current)})`
    );
  }
  const next = current + 1;

  // Issued synchronously after the get resolves, so the transaction stays live.
  // This relies on IndexedDB not auto-committing a transaction across an `await`
  // on one of its own requests — which holds in Chromium, the only target
  // (MV3). A premature commit surfaces as an InvalidStateError from the next
  // request, caught by the caller, not as a lost or duplicated id.
  await requestToPromise(settings.put({ key: EVIDENCE_COUNTER_KEY, value: next }));

  return formatEvidenceId(next);
}
