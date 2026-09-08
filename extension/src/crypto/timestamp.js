/**
 * EVOCK — timestamp abstraction (Role B, B5).
 *
 * Device time is the local clock reading. It is not an independently trusted
 * timestamp. UI and reports must label it "device time" and never "trusted".
 * See spec §25.11, §36.
 *
 * The interface exists so a real RFC 3161 Time-Stamp Authority can be added
 * later without touching the manifest schema: a provider takes the manifest
 * hash plus the device capture time and returns the `timestamp` block. Only the
 * device provider is implemented now. Whatever is added later, the device
 * reading and any trusted-authority token stay in separate, separately named
 * fields — a verifier and a reader must always be able to tell which is which.
 */

/**
 * @typedef {Object} TimestampBlock
 * @property {string} device_capture_time          // ISO-8601 with offset, from capture — NOT Date.now()
 * @property {"not_configured"|"pending"|"ok"|"failed"} trusted_timestamp_status
 * @property {string|null} trusted_timestamp_token
 */

/**
 * @typedef {Object} TimestampProvider
 * @property {string} id
 * @property {(args: { hashHex: string, deviceCaptureTime: string }) => Promise<TimestampBlock>} stamp
 */

/**
 * Records the device's own capture-time reading and nothing more. The
 * trusted-authority fields are present but explicitly unconfigured, so a
 * consumer never has to guess whether a trusted token is simply missing or was
 * never sought.
 *
 * @type {TimestampProvider}
 */
export const DeviceTimestampProvider = {
  id: "device",

  /**
   * @param {{ hashHex?: string, deviceCaptureTime: string }} args
   *   `hashHex` is accepted for interface parity with a future TSA provider and
   *   is not used here — the device clock does not sign anything.
   * @returns {Promise<TimestampBlock>}
   */
  async stamp({ deviceCaptureTime } = {}) {
    // Pass a real value through, or fail. Never substitute (that is what "no
    // fresh clock read" means) and never emit a placeholder: an `undefined`
    // here is silently dropped by canonicalisation, leaving a manifest with no
    // capture time that still hashes, signs and verifies cleanly. Better to stop
    // the whole preservation than to store an evidence record that has lost when
    // it was captured.
    if (typeof deviceCaptureTime !== "string" || deviceCaptureTime.length === 0) {
      throw new TypeError(
        "DeviceTimestampProvider.stamp: deviceCaptureTime must be the capture's ISO-8601 time string"
      );
    }

    return {
      // Pass-through of capture.capturedAt. Never a fresh clock read: the
      // manifest records when the capture happened, not when it was stamped.
      device_capture_time: deviceCaptureTime,
      trusted_timestamp_status: "not_configured",
      trusted_timestamp_token: null
    };
  }
};

Object.freeze(DeviceTimestampProvider);

/**
 * Placeholder for a future RFC 3161 Time-Stamp Authority integration. Present so
 * the seam is visible; it throws until a real TSA is wired in.
 *
 * @type {TimestampProvider}
 */
export const TrustedTimestampProvider = {
  id: "rfc3161",

  async stamp() {
    throw new Error("Trusted timestamping not configured");
  }
};

Object.freeze(TrustedTimestampProvider);

const PROVIDERS = Object.freeze({
  [DeviceTimestampProvider.id]: DeviceTimestampProvider,
  [TrustedTimestampProvider.id]: TrustedTimestampProvider
});

/**
 * Resolve a timestamp provider by id. An unknown id falls back to the device
 * provider, so a bad setting degrades to "device time only" rather than
 * breaking preservation.
 *
 * @param {string} [id]
 * @returns {TimestampProvider}
 */
export function getTimestampProvider(id = "device") {
  return PROVIDERS[id] ?? DeviceTimestampProvider;
}
