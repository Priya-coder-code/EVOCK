// EVOCK Popup Controller - Milestone A4
// Manages Ready screen, Progress/Checklist, Artifact Presentation, Provider Selection, and Settings.

document.addEventListener("DOMContentLoaded", async () => {
  // Views
  const viewReady = document.getElementById("view-ready");
  const viewProgress = document.getElementById("view-progress");
  const viewSettings = document.getElementById("view-settings");

  // Ready Screen Elements
  const readyPageTitle = document.getElementById("ready-page-title");
  const readyPageUrl = document.getElementById("ready-page-url");
  const readyPageDomain = document.getElementById("ready-page-domain");
  const preserveBtn = document.getElementById("preserve-btn");
  const openVaultBtn = document.getElementById("open-vault-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const readyNotice = document.getElementById("ready-notice");

  // Progress Screen Elements
  const progressHeading = document.getElementById("progress-heading");
  const stageScreenshot = document.getElementById("stage-screenshot");
  const stageExtraction = document.getElementById("stage-extraction");
  const captureSuccessPanel = document.getElementById("capture-success-panel");
  const captureErrorPanel = document.getElementById("capture-error-panel");
  const errorMessageEl = document.getElementById("error-message");
  const screenshotImg = document.getElementById("screenshot-img");
  const resetBtn = document.getElementById("reset-btn");
  const tryAgainBtn = document.getElementById("try-again-btn");

  // Capture Metadata Elements
  const metaMime = document.getElementById("meta-mime");
  const metaDimensions = document.getElementById("meta-dimensions");
  const metaTime = document.getElementById("meta-time");
  const metaDomain = document.getElementById("meta-domain");
  const metaUrl = document.getElementById("meta-url");
  const metaMethod = document.getElementById("meta-method");

  // Extraction Metadata Elements (Milestone A4)
  const extractionPanel = document.getElementById("extraction-panel");
  const extractProviderLabel = document.getElementById("extract-provider-label");
  const extractSuccessView = document.getElementById("extract-success-view");
  const extractFailedView = document.getElementById("extract-failed-view");
  const extractPlatform = document.getElementById("extract-platform");
  const extractContact = document.getElementById("extract-contact");
  const extractMessagesCount = document.getElementById("extract-messages-count");
  const extractTime = document.getElementById("extract-time");

  // Settings Elements
  const settingProvider = document.getElementById("setting-provider");
  const settingsBackBtn = document.getElementById("settings-back-btn");
  const settingsDoneBtn = document.getElementById("settings-done-btn");

  /**
   * Switch between popup views.
   * @param {"ready"|"progress"|"settings"} targetView
   */
  function showView(targetView) {
    viewReady.hidden = targetView !== "ready";
    viewProgress.hidden = targetView !== "progress";
    viewSettings.hidden = targetView !== "settings";
  }

  /**
   * Initialize and synchronize provider selection from chrome.storage.local
   */
  async function loadProviderSetting() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const data = await chrome.storage.local.get("extractionProviderId");
        if (data && data.extractionProviderId) {
          settingProvider.value = data.extractionProviderId;
        } else {
          settingProvider.value = "demo";
        }
      }
    } catch (err) {
      console.warn("Could not load provider setting:", err);
    }
  }

  // Handle provider changes in Settings
  settingProvider.addEventListener("change", async () => {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          extractionProviderId: settingProvider.value
        });
        console.log("EVOCK: Provider updated to:", settingProvider.value);
      }
    } catch (err) {
      console.warn("Could not save provider setting:", err);
    }
  });

  /**
   * Query the current active browser tab and populate the ready screen.
   */
  async function loadActiveTabInfo() {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        readyPageTitle.textContent = activeTab.title || "Untitled page";
        readyPageUrl.textContent = activeTab.url || "No URL available";

        let domain = "N/A";
        if (activeTab.url) {
          try {
            const parsed = new URL(activeTab.url);
            domain = parsed.hostname || "N/A";
          } catch {
            domain = "N/A";
          }
        }
        readyPageDomain.textContent = domain;
      } else {
        readyPageTitle.textContent = "No active tab detected";
        readyPageUrl.textContent = "N/A";
        readyPageDomain.textContent = "N/A";
      }
    } catch (error) {
      readyPageTitle.textContent = "Error querying active tab";
      readyPageUrl.textContent = error.message;
      readyPageDomain.textContent = "N/A";
    }
  }

  // Load initial settings and tab context
  await loadProviderSetting();
  await loadActiveTabInfo();

  /**
   * Handle one-click PRESERVE EVIDENCE
   */
  preserveBtn.addEventListener("click", async () => {
    // 1. Immediately switch to progress view without intermediate prompts
    showView("progress");
    progressHeading.textContent = "Preserving Evidence...";

    // 2. Initialize progress stage UI
    stageScreenshot.className = "stage-item stage-active";
    stageScreenshot.innerHTML = `<span class="stage-icon">⏳</span><span class="stage-text">Capturing screenshot...</span>`;

    stageExtraction.className = "stage-item stage-pending";
    stageExtraction.innerHTML = `<span class="stage-icon">○</span><span class="stage-text">AI extraction <span class="stage-tag">Pending</span></span>`;

    captureSuccessPanel.hidden = true;
    captureErrorPanel.hidden = true;
    extractionPanel.hidden = true;
    extractSuccessView.hidden = true;
    extractSuccessView.style.display = "none";
    extractFailedView.hidden = true;
    extractFailedView.style.display = "none";

    // 3. Dispatch preservation request to service worker
    try {
      const response = await chrome.runtime.sendMessage({
        type: "PRESERVE_START"
      });

      if (response && response.ok && response.capture) {
        const capture = response.capture;
        const extraction = response.extraction;

        // Mark screenshot stage complete
        stageScreenshot.className = "stage-item stage-completed";
        stageScreenshot.innerHTML = `<span class="stage-icon">✓</span><span class="stage-text">Screenshot captured</span>`;
        progressHeading.textContent = "Preservation Captured";

        // Display actual screenshot image
        screenshotImg.src = capture.screenshotDataUrl;

        // Populate genuine capture metadata
        metaMime.textContent = capture.mimeType || "image/png";
        metaDimensions.textContent = `${capture.width} × ${capture.height} px`;
        metaTime.textContent = capture.capturedAt || "N/A";
        metaDomain.textContent = capture.domain || "N/A";
        metaUrl.textContent = capture.url || "N/A";
        metaMethod.textContent = capture.captureMethod || "browser_extension.captureVisibleTab";

        // Process Extraction Result (Milestone A4)
        if (extraction) {
          extractionPanel.hidden = false;
          extractProviderLabel.textContent = extraction.provider === "vision" ? "Vision AI" : "Demo Provider";

          if (extraction.status === "ok" && extraction.data) {
            stageExtraction.className = "stage-item stage-completed";
            stageExtraction.innerHTML = `<span class="stage-icon">✓</span><span class="stage-text">AI extraction completed</span>`;

            extractSuccessView.hidden = false;
            extractSuccessView.style.display = "block";
            extractFailedView.hidden = true;
            extractFailedView.style.display = "none";

            extractPlatform.textContent = extraction.data.platform || "N/A";
            extractContact.textContent = extraction.data.contact_name || "N/A";
            extractMessagesCount.textContent = `${extraction.data.messages?.length || 0} message(s)`;
            extractTime.textContent = extraction.data.visible_time || "N/A";
          } else {
            // Rule 2: Degradation is non-alarming. Capture remains preserved and valid.
            stageExtraction.className = "stage-item stage-degraded";
            stageExtraction.innerHTML = `<span class="stage-icon">⚠</span><span class="stage-text">AI extraction unavailable — screenshot preserved without derived metadata.</span>`;

            extractSuccessView.hidden = true;
            extractSuccessView.style.display = "none";
            extractFailedView.hidden = false;
            extractFailedView.style.display = "flex";
          }
        }

        // Reveal success panel with artifact & metadata
        captureSuccessPanel.hidden = false;
      } else {
        // Handle reported failure from service worker
        const errorMsg = response?.error || response?.message || "Failed to capture screenshot.";
        handleCaptureFailure(errorMsg);
      }
    } catch (error) {
      // Handle IPC or unhandled exception
      handleCaptureFailure(error.message || "Failed to communicate with service worker.");
    }
  });

  /**
   * Render capture error state
   * @param {string} message
   */
  function handleCaptureFailure(message) {
    stageScreenshot.className = "stage-item stage-failed";
    stageScreenshot.innerHTML = `<span class="stage-icon">✕</span><span class="stage-text">Screenshot capture failed</span>`;
    progressHeading.textContent = "Capture Failed";
    errorMessageEl.textContent = message;
    captureErrorPanel.hidden = false;
  }

  // Return to ready screen from result or error
  resetBtn.addEventListener("click", async () => {
    await loadActiveTabInfo();
    showView("ready");
  });

  tryAgainBtn.addEventListener("click", async () => {
    await loadActiveTabInfo();
    showView("ready");
  });

  // Open Vault (Role C placeholder)
  openVaultBtn.addEventListener("click", () => {
    readyNotice.textContent = "The Evidence Vault interface is part of Role C and is not yet implemented.";
    readyNotice.hidden = false;
  });

  /**
   * Check health of the local bridge server (Milestone A6)
   */
  async function checkBridgeHealth() {
    const bridgeBadge = document.getElementById("bridge-status-badge");
    if (!bridgeBadge) return;

    bridgeBadge.className = "badge badge-offline";
    bridgeBadge.textContent = "Checking bridge...";

    try {
      const response = await fetch("http://localhost:8787/health", { method: "GET" });
      if (response.ok) {
        const data = await response.json();
        bridgeBadge.className = "badge badge-online";
        bridgeBadge.textContent = data.apiKeyConfigured
          ? "Bridge: Connected"
          : "Bridge: Connected (No API key in .env)";
        return;
      }
    } catch {
      // Bridge is not running or offline
    }

    bridgeBadge.className = "badge badge-offline";
    bridgeBadge.textContent = "Bridge: Not running";
  }

  // Settings navigation
  settingsBtn.addEventListener("click", async () => {
    await loadProviderSetting();
    await checkBridgeHealth();
    showView("settings");
  });

  settingsBackBtn.addEventListener("click", () => {
    showView("ready");
  });

  settingsDoneBtn.addEventListener("click", () => {
    showView("ready");
  });
});
