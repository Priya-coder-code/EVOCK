/**
 * EVOCK - Screenshot Capture Module
 * 
 * Captures the visible tab as a PNG and produces a CaptureResult
 * complying with Plan/Building Plan.md §5.1 and Plan/Role A.md A2.
 */

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
 * Determine if a URL is a restricted browser internal or store page.
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
    url.startsWith("about:") ||
    url.startsWith("view-source:") ||
    url.includes("chrome.google.com/webstore") ||
    url.includes("chromewebstore.google.com")
  );
}

/**
 * Reads actual image dimensions from a base64 data URL using createImageBitmap.
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
    // Fallback conversion from base64 data URL to Blob
    const base64Index = dataUrl.indexOf(",");
    const base64 = base64Index !== -1 ? dataUrl.slice(base64Index + 1) : dataUrl;
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: "image/png" });
  }

  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  return { width, height };
}

/**
 * Captures the currently active browser tab and returns a CaptureResult object.
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
  // 1. Query the active tab in the current window
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  // 2. Error if no active tab found
  if (!tab) {
    throw new Error("No active tab found in current window.");
  }

  // 3. Error if active tab has no tab ID
  if (tab.id === undefined || tab.id === null) {
    throw new Error("Active tab has no valid tab ID.");
  }

  // Check for restricted browser pages
  if (isRestrictedUrl(tab.url)) {
    throw new Error("This page cannot be captured by browser extensions.");
  }

  // 4. Capture visible tab as PNG
  let screenshotDataUrl;
  try {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png"
    });
  } catch (error) {
    const errMsg = error?.message || "";
    if (
      errMsg.includes("cannot access") ||
      errMsg.includes("Cannot access") ||
      errMsg.includes("restricted")
    ) {
      throw new Error("This page cannot be captured by browser extensions.");
    }
    throw new Error(`Failed to capture visible tab: ${errMsg}`);
  }

  if (!screenshotDataUrl) {
    throw new Error("Failed to capture screenshot: received empty image data.");
  }

  // 5. Read actual screenshot dimensions using createImageBitmap
  const { width, height } = await getImageDimensions(screenshotDataUrl);

  // Extract hostname domain safely
  let domain = "";
  if (tab.url) {
    try {
      const parsedUrl = new URL(tab.url);
      domain = parsedUrl.hostname;
    } catch {
      domain = "";
    }
  }

  // Construct and return the frozen CaptureResult contract (§5.1)
  return {
    screenshotDataUrl,
    mimeType: "image/png",
    width,
    height,
    url: tab.url || "",
    domain,
    tabTitle: tab.title || "",
    capturedAt: formatIsoWithOffset(new Date()),
    captureMethod: "browser_extension.captureVisibleTab"
  };
}
