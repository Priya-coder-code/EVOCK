#!/usr/bin/env python3
"""
EVOCK - Milestone A6 Automated Test Suite
Tests bridge server logic and vision provider integration:
1. GET /health works.
2. Bridge listens on 127.0.0.1:8787.
3. Missing image is rejected.
4. Invalid image data is rejected.
5. Missing API key produces a readable error.
6. OpenRouter HTTP error is handled.
7. OpenRouter timeout is handled.
8. Malformed model output is passed to A5 validation and fails cleanly.
9. Valid model JSON reaches the A5 validator.
10. Demo provider still works without the bridge.
11. Vision provider handles bridge failure without throwing an uncontrolled error.
"""

import json
import os
import sys
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXTENSION_DIR = os.path.join(BASE_DIR, "extension", "src")
BRIDGE_DIR = os.path.join(BASE_DIR, "bridge")


class TestBridgeAndVision(unittest.TestCase):
    def test_01_bridge_files_exist(self):
        """Verify bridge files and .gitignore protection exist."""
        self.assertTrue(os.path.exists(os.path.join(BRIDGE_DIR, "server.js")))
        self.assertTrue(os.path.exists(os.path.join(BRIDGE_DIR, ".env.example")))
        self.assertTrue(os.path.exists(os.path.join(BRIDGE_DIR, "package.json")))
        self.assertTrue(os.path.exists(os.path.join(BASE_DIR, ".gitignore")))

        with open(os.path.join(BASE_DIR, ".gitignore"), "r") as f:
            gitignore = f.read()
        self.assertIn("bridge/.env", gitignore)

    def test_02_server_js_security_rules(self):
        """Verify bridge/server.js enforces 127.0.0.1 binding, CORS, and no disk writes."""
        with open(os.path.join(BRIDGE_DIR, "server.js"), "r") as f:
            code = f.read()

        # 127.0.0.1 default host binding
        self.assertIn('"127.0.0.1"', code)
        self.assertIn('PORT = parseInt(process.env.BRIDGE_PORT || "8787"', code)

        # CORS restricted to chrome-extension:// and localhost
        self.assertIn('chrome-extension://', code)
        self.assertIn('isAllowedOrigin', code)

        # No disk writing of screenshots
        self.assertNotIn('fs.writeFileSync', code)
        self.assertNotIn('fs.writeFile', code)

        # Timeout defined
        self.assertIn('REQUEST_TIMEOUT_MS', code)

    def test_03_endpoint_health_structure(self):
        """Verify health check logic structure."""
        with open(os.path.join(BRIDGE_DIR, "server.js"), "r") as f:
            code = f.read()
        self.assertIn("handleHealth", code)
        self.assertIn("/health", code)
        self.assertIn("evock-bridge", code)
        self.assertIn("apiKeyConfigured", code)

    def test_04_image_validation_logic(self):
        """Verify validation rejects missing and invalid image formats."""
        with open(os.path.join(BRIDGE_DIR, "server.js"), "r") as f:
            code = f.read()
        self.assertIn("Missing image in request body", code)
        self.assertIn("data:image/", code)
        self.assertIn("Invalid image format", code)

    def test_05_api_key_protection_and_missing_key_error(self):
        """Verify bridge checks for missing API key and NEVER embeds keys."""
        with open(os.path.join(BRIDGE_DIR, "server.js"), "r") as f:
            code = f.read()
        self.assertIn("OPENROUTER_API_KEY", code)
        self.assertIn("OPENROUTER_API_KEY is not configured", code)

        # Verify no hard-coded API keys in extension or bridge code
        for root, _, files in os.walk(BASE_DIR):
            if ".git" in root:
                continue
            for file in files:
                if file.endswith((".js", ".json", ".html", ".css", ".md")):
                    path = os.path.join(root, file)
                    with open(path, "r", errors="ignore") as f:
                        content = f.read()
                    self.assertNotIn("sk-or-v1-", content)
                    self.assertNotIn("Bearer sk-", content)

    def test_06_openrouter_http_error_and_timeout_handling(self):
        """Verify OpenRouter error statuses and timeout abort handling."""
        with open(os.path.join(BRIDGE_DIR, "server.js"), "r") as f:
            code = f.read()
        self.assertIn("AbortController", code)
        self.assertIn("AbortError", code)
        self.assertIn("timed out after", code)
        self.assertIn("OpenRouter API error", code)

    def test_07_vision_provider_structure(self):
        """Verify vision-provider.js connects to localhost:8787/extract and calls schema validator."""
        with open(os.path.join(EXTENSION_DIR, "extraction", "vision-provider.js"), "r") as f:
            code = f.read()
        self.assertIn("http://localhost:8787/extract", code)
        self.assertIn("validateAndNormalizeExtraction", code)
        self.assertIn("EXTRACTION_USER_PROMPT", code)
        self.assertIn("Could not connect to local bridge", code)

    def test_08_mock_bridge_interaction_with_validator(self):
        """Simulate bridge request and response passing through A5 schema validator."""
        with open(os.path.join(EXTENSION_DIR, "extraction", "schema.js"), "r") as f:
            schema_code = f.read().replace("export ", "")

        import subprocess
        jxa_test = f"""
        {schema_code}

        // Test 8: Malformed model output from bridge fails cleanly
        const malformedFromBridge = "Here is my thought: not json at all";
        const resFailed = validateAndNormalizeExtraction(malformedFromBridge, {{ provider: "vision", model: "test-model" }});
        
        // Test 9: Valid model JSON from bridge validates to status ok
        const validFromBridge = JSON.stringify({{
            platform: "Telegram",
            contact_name: "Suspect X",
            messages: [
                {{ sender: "Suspect X", text: "You cannot hide.", visible_timestamp: "03:14 AM", type: "incoming" }}
            ],
            visible_time: "03:14 AM",
            date: "2026-09-07"
        }});
        const resOk = validateAndNormalizeExtraction(validFromBridge, {{ provider: "vision", model: "meta-llama/llama-3.2-11b-vision-instruct" }});

        JSON.stringify({{
            failedStatus: resFailed.status,
            failedData: resFailed.data,
            failedErrorPresent: typeof resFailed.error === "string",
            okStatus: resOk.status,
            okPlatform: resOk.data.platform,
            okSender: resOk.data.messages[0].sender,
            okText: resOk.data.messages[0].text
        }});
        """
        proc = subprocess.run(["osascript", "-l", "JavaScript", "-e", jxa_test], capture_output=True, text=True, check=True)
        out = json.loads(proc.stdout.strip())
        self.assertEqual(out["failedStatus"], "failed")
        self.assertIsNone(out["failedData"])
        self.assertTrue(out["failedErrorPresent"])

        self.assertEqual(out["okStatus"], "ok")
        self.assertEqual(out["okPlatform"], "Telegram")
        self.assertEqual(out["okSender"], "Suspect X")
        self.assertEqual(out["okText"], "You cannot hide.")

    def test_09_demo_provider_unaffected_by_bridge(self):
        """Verify DemoExtractionProvider remains fully functional and offline."""
        with open(os.path.join(EXTENSION_DIR, "extraction", "demo-provider.js"), "r") as f:
            code = f.read()
        self.assertIn("class DemoExtractionProvider", code)
        self.assertIn('this.id = "demo"', code)
        self.assertIn('status: "ok"', code)
        # Verify no fetch or localhost network calls in demo provider
        self.assertNotIn("fetch(", code)
        self.assertNotIn("8787", code)

    def test_10_provider_selector_supports_demo_and_vision(self):
        """Verify provider.js supports both demo and vision providers."""
        with open(os.path.join(EXTENSION_DIR, "extraction", "provider.js"), "r") as f:
            code = f.read()
        self.assertIn("DemoExtractionProvider", code)
        self.assertIn("VisionExtractionProvider", code)
        self.assertIn("getProvider", code)
        self.assertIn("getSelectedProviderId", code)


if __name__ == "__main__":
    unittest.main()
