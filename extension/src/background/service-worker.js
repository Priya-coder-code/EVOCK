// EVOCK Service Worker - Background Orchestrator
import { captureVisibleTab } from "../capture/capture.js";
import { getProvider, getSelectedProviderId } from "../extraction/provider.js";

console.log("EVOCK service worker loaded");

// Listen for messages from extension popup or other components
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "PRESERVE_START") {
    // Run async capture and extraction without allowing unhandled errors to crash the service worker
    (async () => {
      try {
        // Step 1: Capture screenshot
        const captureResult = await captureVisibleTab();

        console.log("EVOCK: Screenshot capture succeeded");
        console.log("EVOCK: CaptureResult metadata:", {
          mimeType: captureResult.mimeType,
          width: captureResult.width,
          height: captureResult.height,
          url: captureResult.url,
          domain: captureResult.domain,
          tabTitle: captureResult.tabTitle,
          capturedAt: captureResult.capturedAt,
          captureMethod: captureResult.captureMethod,
          screenshotDataUrlLength: captureResult.screenshotDataUrl?.length
        });

        // Step 2: Information extraction via configured provider (Milestone A4)
        // Rule 2 & 10: Preservation must never depend on extraction. If extraction fails,
        // the captured screenshot remains preserved and usable.
        let extractionResult = null;
        try {
          const providerId = await getSelectedProviderId();
          const provider = getProvider(providerId);
          console.log(`EVOCK: Running extraction with provider: ${provider.id}`);

          extractionResult = await provider.extract(captureResult);
          console.log("EVOCK: Extraction completed:", extractionResult);
        } catch (extError) {
          console.warn("EVOCK: Extraction threw error (degrading gracefully):", extError);
          extractionResult = {
            provider: "unknown",
            model: null,
            extractedAt: new Date().toISOString(),
            data: null,
            status: "failed",
            error: extError.message || "Extraction encountered an unexpected error."
          };
        }

        sendResponse({
          ok: true,
          message: "Preservation capture and extraction processed",
          capture: captureResult,
          extraction: extractionResult
        });
      } catch (error) {
        console.error("EVOCK: Screenshot capture failed:", error);

        sendResponse({
          ok: false,
          error: error.message || "Failed to capture screenshot",
          message: error.message || "Failed to capture screenshot"
        });
      }
    })();

    // Return true to indicate we will respond asynchronously via sendResponse
    return true;
  }
});
