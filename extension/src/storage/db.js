/**
 * EVOCK — IndexedDB schema and promise wrapper (Role B, B3/B6).
 *
 * IndexedDB is the only browser store that holds large binary data with real
 * indexes, survives restarts, and can persist `CryptoKey` objects through
 * structured clone. That last property is why the keystore lives here rather
 * than in `chrome.storage`: a non-extractable private key can be stored and
 * reloaded without its key material ever being serialised into readable bytes.
 *
 * This module owns the schema and the raw request/transaction plumbing. It is
 * deliberately dependency-free — the `idb` wrapper would be ~1 KB of convenience
 * over the thirty lines below, and the evidence core keeps its dependency count
 * at zero.
 *
 * Only `storage/vault-repo.js` (step 06) and `crypto/keystore.js` may talk to
 * IndexedDB through this module.
 */

export const DB_NAME = "evock-vault";
export const DB_VERSION = 1;

export const STORE_EVIDENCE = "evidence";
export const STORE_KEYS = "keys";
export const STORE_SETTINGS = "settings";

export const INDEX_BY_CREATED_AT = "by_created_at";
export const INDEX_BY_PLATFORM = "by_platform";

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/** The connection `dbPromise` resolved to, so lifecycle handlers can identify it. */
/** @type {IDBDatabase|null} */
let openConnection = null;

/**
 * Open the vault database, creating it on first use.
 *
 * The connection is memoised: every caller in this context shares one, so a
 * capture does not race an upgrade against itself.
 *
 * @returns {Promise<IDBDatabase>}
 */
export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // `blocked` rejects, but the underlying open can still succeed later. Track
      // whether we have already settled so a late connection is closed instead
      // of leaking — an unclosed connection blocks the next upgrade forever.
      let settled = false;

      request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);

      request.onerror = () => {
        settled = true;
        reject(request.error);
      };

      request.onblocked = () => {
        settled = true;
        reject(new Error("openDb: blocked by an older connection in another tab"));
      };

      request.onsuccess = () => {
        const db = request.result;

        if (settled) {
          db.close();
          return;
        }
        settled = true;
        openConnection = db;

        // If another context needs to upgrade, step out of its way rather than
        // blocking it forever. Only drop the cache if it still refers to this
        // connection: a newer one may already have replaced it.
        db.onversionchange = () => {
          db.close();
          if (openConnection === db) {
            openConnection = null;
            dbPromise = null;
          }
        };

        resolve(db);
      };
    }).catch((error) => {
      // A failed open must not be cached, or every later call fails too.
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/**
 * Create the v1 schema.
 *
 * @param {IDBDatabase} db
 * @param {number} oldVersion
 */
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const evidence = db.createObjectStore(STORE_EVIDENCE, { keyPath: "evidence_id" });
    // Timeline ordering and platform grouping are index scans, so `list()` can
    // read metadata without ever touching a screenshot blob (step 06).
    evidence.createIndex(INDEX_BY_CREATED_AT, "created_at");
    evidence.createIndex(INDEX_BY_PLATFORM, "platform_label");

    // Holds the signing keypair and the vault key as CryptoKey objects.
    db.createObjectStore(STORE_KEYS, { keyPath: "id" });

    // Holds the evidence-id counter and any future vault settings.
    db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
  }
}

/**
 * Resolve with an IDBRequest's result.
 *
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resolve when a transaction commits, reject if it errors or aborts.
 *
 * A write is only real once the transaction completes, so callers must await
 * this rather than the individual request: a half-written evidence record is
 * worse than a failed capture, because it looks real.
 *
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });
}

/**
 * Close the memoised connection. Intended for tests and for teardown; normal
 * code never needs it.
 */
export async function closeDb() {
  // Clear the cache before awaiting. Holding it across the await handed any
  // caller arriving in that window the very connection about to be closed, which
  // then failed with InvalidStateError on first use.
  const pending = dbPromise;
  dbPromise = null;
  openConnection = null;

  if (!pending) return;
  const db = await pending.catch(() => null);
  db?.close();
}
