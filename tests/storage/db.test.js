/**
 * EVOCK — IndexedDB schema tests (Role B step 03, B3/B6).
 */

import { describe, expect, it } from "vitest";
import {
  DB_NAME,
  DB_VERSION,
  INDEX_BY_CREATED_AT,
  INDEX_BY_PLATFORM,
  openDb,
  requestToPromise,
  STORE_EVIDENCE,
  STORE_KEYS,
  STORE_SETTINGS,
  txDone
} from "../../extension/src/storage/db.js";

describe("openDb — schema v1", () => {
  it("opens the vault database at the declared name and version", async () => {
    const db = await openDb();

    expect(DB_NAME).toBe("evock-vault");
    expect(DB_VERSION).toBe(1);
    expect(db.name).toBe(DB_NAME);
    expect(db.version).toBe(DB_VERSION);
  });

  it("creates the three object stores", async () => {
    const db = await openDb();
    const names = Array.from(db.objectStoreNames).sort();

    expect(names).toEqual([STORE_EVIDENCE, STORE_KEYS, STORE_SETTINGS].sort());
  });

  it("keys the evidence store by evidence_id", async () => {
    const db = await openDb();
    const store = db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE);

    expect(store.keyPath).toBe("evidence_id");
  });

  it("creates both evidence indexes over the right key paths", async () => {
    const db = await openDb();
    const store = db.transaction(STORE_EVIDENCE, "readonly").objectStore(STORE_EVIDENCE);

    expect(Array.from(store.indexNames).sort()).toEqual(
      [INDEX_BY_CREATED_AT, INDEX_BY_PLATFORM].sort()
    );
    expect(store.index(INDEX_BY_CREATED_AT).keyPath).toBe("created_at");
    expect(store.index(INDEX_BY_PLATFORM).keyPath).toBe("platform_label");
  });

  it("keys the keys and settings stores by id and key", async () => {
    const db = await openDb();
    const tx = db.transaction([STORE_KEYS, STORE_SETTINGS], "readonly");

    expect(tx.objectStore(STORE_KEYS).keyPath).toBe("id");
    expect(tx.objectStore(STORE_SETTINGS).keyPath).toBe("key");
  });

  it("memoises the connection", async () => {
    expect(await openDb()).toBe(await openDb());
  });
});

describe("promise wrappers", () => {
  it("resolves a request with its result and a transaction on commit", async () => {
    const db = await openDb();

    const writeTx = db.transaction(STORE_SETTINGS, "readwrite");
    writeTx.objectStore(STORE_SETTINGS).put({ key: "probe", value: 42 });
    await expect(txDone(writeTx)).resolves.toBeUndefined();

    const stored = await requestToPromise(
      db.transaction(STORE_SETTINGS, "readonly").objectStore(STORE_SETTINGS).get("probe")
    );
    expect(stored).toEqual({ key: "probe", value: 42 });
  });

  it("rejects a request that fails", async () => {
    const db = await openDb();
    const tx = db.transaction(STORE_SETTINGS, "readwrite");
    const store = tx.objectStore(STORE_SETTINGS);

    store.add({ key: "dupe" });
    await requestToPromise(store.add({ key: "dupe" })).then(
      () => expect.unreachable("a duplicate add should reject"),
      (error) => expect(error.name).toBe("ConstraintError")
    );
  });
});
