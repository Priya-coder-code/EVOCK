/**
 * EVOCK — timestamp abstraction tests (Role B step 05, B5).
 *
 * The rule under test matters more than the code: device time is never
 * presented as a trusted timestamp.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeviceTimestampProvider,
  getTimestampProvider,
  TrustedTimestampProvider
} from "../../extension/src/crypto/timestamp.js";

const DEVICE_TIME = "2026-09-01T23:31:14+05:30";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("DeviceTimestampProvider.stamp", () => {
  it("returns exactly the three timestamp-block fields", async () => {
    const block = await DeviceTimestampProvider.stamp({ deviceCaptureTime: DEVICE_TIME });

    expect(Object.keys(block).sort()).toEqual(
      ["device_capture_time", "trusted_timestamp_status", "trusted_timestamp_token"].sort()
    );
    expect(block).toEqual({
      device_capture_time: DEVICE_TIME,
      trusted_timestamp_status: "not_configured",
      trusted_timestamp_token: null
    });
  });

  it("passes the capture time straight through", async () => {
    const other = "2020-01-02T03:04:05-08:00";
    const block = await DeviceTimestampProvider.stamp({ deviceCaptureTime: other });

    expect(block.device_capture_time).toBe(other);
  });

  it("does not read the wall clock — a mocked Date does not change the output", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("1999-12-31T23:59:59Z"));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(4102444800000); // 2100-01-01

    const block = await DeviceTimestampProvider.stamp({ deviceCaptureTime: DEVICE_TIME });

    expect(block.device_capture_time).toBe(DEVICE_TIME);
    expect(nowSpy).not.toHaveBeenCalled();
  });

  it("ignores the hashHex argument (device clock signs nothing)", async () => {
    const withHash = await DeviceTimestampProvider.stamp({
      hashHex: "a".repeat(64),
      deviceCaptureTime: DEVICE_TIME
    });
    const withoutHash = await DeviceTimestampProvider.stamp({ deviceCaptureTime: DEVICE_TIME });

    expect(withHash).toEqual(withoutHash);
  });

  it("has id 'device'", () => {
    expect(DeviceTimestampProvider.id).toBe("device");
  });
});

describe("TrustedTimestampProvider", () => {
  it("is a stub that rejects with the not-configured message", async () => {
    await expect(TrustedTimestampProvider.stamp()).rejects.toThrow(
      "Trusted timestamping not configured"
    );
  });

  it("has id 'rfc3161'", () => {
    expect(TrustedTimestampProvider.id).toBe("rfc3161");
  });
});

describe("getTimestampProvider", () => {
  it("returns the device provider by default and for 'device'", () => {
    expect(getTimestampProvider()).toBe(DeviceTimestampProvider);
    expect(getTimestampProvider("device")).toBe(DeviceTimestampProvider);
  });

  it("returns the trusted provider for 'rfc3161'", () => {
    expect(getTimestampProvider("rfc3161")).toBe(TrustedTimestampProvider);
  });

  it("falls back to the device provider for an unknown id", () => {
    expect(getTimestampProvider("nonsense")).toBe(DeviceTimestampProvider);
    expect(getTimestampProvider(null)).toBe(DeviceTimestampProvider);
  });
});

describe("source rule — device time is not conflated with trusted time", () => {
  const source = fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../extension/src/crypto/timestamp.js"
    ),
    "utf8"
  );

  it("does not put 'trusted' on the device_capture_time assignment line", () => {
    const assignmentLines = source
      .split("\n")
      .filter((line) => /device_capture_time\s*:/.test(line));

    expect(assignmentLines.length).toBeGreaterThan(0);
    for (const line of assignmentLines) {
      expect(line.toLowerCase()).not.toContain("trusted");
    }
  });

  it("keeps the device reading and the trusted status in separate fields", () => {
    expect(source).toContain("device_capture_time");
    expect(source).toContain("trusted_timestamp_status");
    expect(source).toContain("trusted_timestamp_token");
  });
});

describe("DeviceTimestampProvider.stamp — refuses to emit a missing capture time", () => {
  // An undefined device_capture_time is dropped by canonicalisation, so the
  // manifest still hashes and verifies while having lost when the capture
  // happened. The provider stops that at the source.
  it.each([
    ["no argument", undefined],
    ["empty object", {}],
    ["undefined time", { deviceCaptureTime: undefined }],
    ["null time", { deviceCaptureTime: null }],
    ["empty string", { deviceCaptureTime: "" }],
    ["a number", { deviceCaptureTime: 1_725_219_074_000 }],
    ["a Date object", { deviceCaptureTime: new Date() }]
  ])("throws for %s", async (_label, arg) => {
    await expect(DeviceTimestampProvider.stamp(arg)).rejects.toThrow(/deviceCaptureTime/);
  });
});

describe("providers are immutable singletons", () => {
  it("cannot be mutated by a caller", () => {
    const provider = getTimestampProvider("device");

    expect(() => {
      provider.id = "spoofed";
    }).toThrow();
    expect(DeviceTimestampProvider.id).toBe("device");
    expect(typeof getTimestampProvider("device").stamp).toBe("function");
  });

  it("hands back the same frozen object every time", () => {
    expect(Object.isFrozen(getTimestampProvider("device"))).toBe(true);
    expect(Object.isFrozen(getTimestampProvider("rfc3161"))).toBe(true);
  });
});
