/**
 * EVOCK - Screenshot Capture Module
 *
 * Captures the visible tab as a PNG and produces a CaptureResult
 * complying with Plan/Building Plan.md §5.1 and Plan/Role A.md A2.
 *
 * This module is the front of the pipeline and must fail loudly and clearly:
 * every failure mode is turned into a human-readable Error, never a silent
 * null or a fabricated dimension.
 */

/** PNG only. JPEG is lossy and we are about to hash this as "the original". */
const CAPTURE_FORMAT = "png";

/** One automatic retry when Chrome's per-second capture quota is hit. */
const QUOTA_RETRY_DELAY_MS = 600;

/**
 * Format a Date object as an ISO-8601 string including the local UTC offset.
 * Example output: "2026-09-07T22:30:15+05:30"
 *
 * @param {Date} date
 * @returns {string}
 */
function formatIsoWithOffset(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  const timezoneOffset = -date.getTimezoneOffset();
  const sign = timezoneOffset >= 0 ? "+" : "-";
  const absOffset = Math.abs(timezoneOffset);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMinutes = pad(absOffset % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMinutes}`;
}

/**
 * Determine if a URL is a restricted browser-internal or store page that
 * extensions are never allowed to screenshot.
 *
 * @param {string|undefined} url
 * @returns {boolean}
 */
function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:") ||
    url.includes("chrome.google.com/webstore") ||
    url.includes("chromewebstore.google.com")
  );
}

/**
 * Classify a raw chrome.tabs.captureVisibleTab error into an actionable
 * Error with a message the popup can show verbatim.
 *
 * @param {unknown} error
 * @returns {{ error: Error, isQuota: boolean }}
 */
function classifyCaptureError(error) {
  const raw = (error && error.message) ? String(error.message) : String(error || "");
  const lc = raw.toLowerCase();

  if (lc.includes("max_capture_visible_tab_calls_per_second") || lc.includes("quota")) {
    return {
      error: new Error("Chrome is rate-limiting screenshots. Please try again in a moment."),
      isQuota: true
    };
  }

  // activeTab has not been granted yet: the capture must be started by an
  // explicit click on the extension, not a keyboard shortcut or context menu.
  if (
    lc.includes("activetab") ||
    lc.includes("not been invoked") ||
    lc.includes("not in effect") ||
    lc.includes("has not been granted")
  ) {
    return {
      error: new Error(
        "EVOCK needs an explicit click. Open the EVOCK popup on the page you want to keep and press PRESERVE EVIDENCE."
      ),
      isQuota: false
    };
  }

  if (
    lc.includes("cannot access") ||
    lc.includes("restricted") ||
    lc.includes("cannot be scripted") ||
    lc.includes("chrome:// url")
  ) {
    return {
      error: new Error("This page cannot be captured by browser extensions."),
      isQuota: false
    };
  }

  return { error: new Error(`Failed to capture visible tab: ${raw || "unknown error"}`), isQuota: false };
}

/**
 * Call chrome.tabs.captureVisibleTab, retrying once if Chrome's per-second
 * capture quota is hit.
 *
 * @param {number|undefined} windowId
 * @returns {Promise<string>} the screenshot data URL
 */
async function captureWithRetry(windowId) {
  try {
    return await chrome.tabs.captureVisibleTab(windowId, { format: CAPTURE_FORMAT });
  } catch (error) {
    const { error: classified, isQuota } = classifyCaptureError(error);
    if (!isQuota) throw classified;

    await new Promise((resolve) => setTimeout(resolve, QUOTA_RETRY_DELAY_MS));
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: CAPTURE_FORMAT });
    } catch (retryError) {
      throw classifyCaptureError(retryError).error;
    }
  }
}

/**
 * Reads the true pixel dimensions of the captured PNG. The captured image size
 * is not the same as the tab/window size, and the manifest must record the
 * real thing (Plan/Role A.md A2).
 *
 * @param {string} dataUrl
 * @returns {Promise<{width: number, height: number}>}
 */
async function getImageDimensions(dataUrl) {
  let blob;
  try {
    const response = await fetch(dataUrl);
    blob = await response.blob();
  } catch {
    // Fallback: decode the base64 data URL to a Blob by hand.
    const base64Index = dataUrl.indexOf(",");
    const base64 = base64Index !== -1 ? dataUrl.slice(base64Index + 1) : dataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: "image/png" });
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    throw new Error(
      `Screenshot was captured but its dimensions could not be read (${err?.message || "decode failed"}).`
    );
  }

  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Screenshot was captured but reported invalid dimensions.");
  }

  return { width, height };
}

/**
 * Captures the currently active browser tab and returns a CaptureResult object
 * matching the frozen §5.1 contract exactly.
 *
 * @returns {Promise<{
 *   screenshotDataUrl: string,
 *   mimeType: string,
 *   width: number,
 *   height: number,
 *   url: string,
 *   domain: string,
 *   tabTitle: string,
 *   capturedAt: string,
 *   captureMethod: string
 * }>}
 */
export async function captureVisibleTab() {
  // 1. Resolve the active tab.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    throw new Error("No active tab found in the current window.");
  }
  if (tab.id === undefined || tab.id === null) {
    throw new Error("The active tab has no valid tab ID and cannot be captured.");
  }

  // 2. Reject known-restricted pages before spending a capture call.
  if (isRestrictedUrl(tab.url)) {
    throw new Error("This page cannot be captured by browser extensions.");
  }

  // 3. Capture (PNG, with one automatic retry on Chrome's per-second quota).
  const screenshotDataUrl = await captureWithRetry(tab.windowId);
  // Timestamp the moment of capture, from the device clock, with local offset.
  const capturedAt = formatIsoWithOffset(new Date());

  if (!screenshotDataUrl || typeof screenshotDataUrl !== "string") {
    throw new Error("Screenshot capture returned empty image data.");
  }

  // 4. Record the real captured-image dimensions.
  const { width, height } = await getImageDimensions(screenshotDataUrl);

  // 5. Derive the hostname for grouping; never let a bad URL throw here.
  let domain = "";
  if (tab.url) {
    try {
      domain = new URL(tab.url).hostname;
    } catch {
      domain = "";
    }
  }

  // 6. Frozen CaptureResult contract (§5.1).
  return {
    screenshotDataUrl,
    mimeType: "image/png",
    width,
    height,
    url: tab.url || "",
    domain,
    tabTitle: tab.title || "",
    capturedAt,
    captureMethod: "browser_extension.captureVisibleTab"
  };
}
