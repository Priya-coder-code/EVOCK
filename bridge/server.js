/**
 * EVOCK - Local Node.js Proxy Bridge
 *
 * Implements the local API-key bridge according to Plan/Role A.md A6
 * and Plan/Building Plan.md §3.3 & §8.
 *
 * CRITICAL SECURITY ARCHITECTURE:
 * 1. Holds the OPENROUTER_API_KEY on the developer's local machine via .env.
 * 2. Listens ONLY on 127.0.0.1:8787 (never 0.0.0.0).
 * 3. Restricts CORS to Chrome extension origins (chrome-extension://) and localhost.
 * 4. NEVER logs the screenshot image, API key, or sensitive evidence message texts.
 * 5. NEVER writes screenshots to disk.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file manually or via dotenv
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex !== -1) {
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}
loadEnv();

// Attempt to load dotenv if available in node_modules
try {
  const dotenv = await import("dotenv");
  dotenv.config?.({ path: path.join(__dirname, ".env") });
} catch {
  // Built-in env loader handled it
}

const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const PORT = parseInt(process.env.BRIDGE_PORT || "8787", 10);
const DEFAULT_MODEL = "meta-llama/llama-3.2-11b-vision-instruct:free";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30000; // 30 second timeout per Role A.md

/**
 * Validates whether the origin is a trusted extension or local developer context.
 * @param {string|undefined} origin
 * @returns {boolean}
 */
function isAllowedOrigin(origin) {
  if (!origin) return true; // Direct local requests (curl, extensions without origin)
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://localhost")
  );
}

/**
 * Sets restricted CORS headers based on request origin.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @returns {boolean} True if origin was allowed, false if rejected
 */
function handleCors(req, res) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");
  } else if (origin) {
    return false;
  }
  return true;
}

/**
 * Handle GET /health
 */
function handleHealth(req, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const status = {
    status: "ok",
    service: "evock-bridge",
    version: "0.1.0",
    model,
    apiKeyConfigured: Boolean(apiKey && apiKey.trim().length > 0)
  };

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(status, null, 2));
}

/**
 * Handle POST /extract
 */
async function handleExtract(req, res, bodyString) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] POST /extract - Request received`);

  let body;
  try {
    body = JSON.parse(bodyString);
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] POST /extract - Invalid JSON body: ${err.message}`);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Invalid JSON request body." }));
  }

  // 1. Validate image presence
  if (!body.image || typeof body.image !== "string") {
    console.warn(`[${new Date().toISOString()}] POST /extract - Missing or invalid image field`);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Missing image in request body." }));
  }

  // 2. Validate image format (must be data URL)
  if (!body.image.startsWith("data:image/")) {
    console.warn(`[${new Date().toISOString()}] POST /extract - Unsupported image format`);
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: false,
        error: "Invalid image format: must be a base64 image data URL (e.g. data:image/png;base64,...)."
      })
    );
  }

  // 3. Validate OpenRouter API key configuration
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.error(`[${new Date().toISOString()}] POST /extract - OPENROUTER_API_KEY is missing`);
    res.writeHead(500, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: false,
        error: "OPENROUTER_API_KEY is not configured in bridge/.env. Please configure your API key."
      })
    );
  }

  const model = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  const userPrompt =
    body.prompt ||
    "Extract visible digital conversation metadata from this screenshot into strict JSON.";

  console.log(
    `[${new Date().toISOString()}] POST /extract - Dispatching to OpenRouter (model: ${model}, image length: ${body.image.length} chars)`
  );

  // 4. Construct OpenRouter chat completion request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const openRouterResponse = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:8787",
        "X-Title": "EVOCK Digital Evidence Preservation"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a digital evidence preservation assistant for EVOCK. Extract ONLY visibly present digital evidence in strict JSON. Never guess, infer, hallucinate, or alter message text."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt
              },
              {
                type: "image_url",
                image_url: {
                  url: body.image
                }
              }
            ]
          }
        ],
        response_format: {
          type: "json_object"
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text();
      let errorDetails = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch {}

      console.error(
        `[${new Date().toISOString()}] OpenRouter failed in ${duration}ms (status: ${openRouterResponse.status}): ${errorDetails}`
      );

      res.writeHead(openRouterResponse.status, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: false,
          error: `OpenRouter API error (${openRouterResponse.status}): ${errorDetails}`
        })
      );
    }

    const openRouterData = await openRouterResponse.json();
    const content = openRouterData.choices?.[0]?.message?.content;

    if (!content) {
      console.warn(`[${new Date().toISOString()}] OpenRouter returned empty content in ${duration}ms`);
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: false,
          error: "OpenRouter returned empty content in model completion."
        })
      );
    }

    console.log(`[${new Date().toISOString()}] POST /extract - Success in ${duration}ms (model: ${openRouterData.model || model})`);

    // Return model output cleanly to extension
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: true,
        model: openRouterData.model || model,
        content
      })
    );
  } catch (fetchError) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;

    if (fetchError.name === "AbortError") {
      console.error(`[${new Date().toISOString()}] POST /extract - OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      res.writeHead(504, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          ok: false,
          error: `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
        })
      );
    }

    console.error(`[${new Date().toISOString()}] POST /extract - Network/Fetch error: ${fetchError.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        ok: false,
        error: `Failed to communicate with OpenRouter: ${fetchError.message}`
      })
    );
  }
}

/**
 * Initializes and starts the HTTP server.
 */
export function createBridgeServer() {
  const server = http.createServer(async (req, res) => {
    // 1. CORS Check
    const allowed = handleCors(req, res);
    if (!allowed) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Origin not allowed by bridge CORS policy." }));
    }

    // 2. Preflight OPTIONS
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    // 3. GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      return handleHealth(req, res);
    }

    // 4. POST /extract
    if (req.method === "POST" && url.pathname === "/extract") {
      let body = "";
      const maxLimit = 10 * 1024 * 1024; // 10MB limit per Role A.md

      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > maxLimit) {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Payload exceeds 10MB limit." }));
          req.destroy();
        }
      });

      req.on("end", async () => {
        if (body.length <= maxLimit) {
          await handleExtract(req, res, body);
        }
      });
      return;
    }

    // 404 Not Found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `Route not found: ${req.method} ${url.pathname}` }));
  });

  return server;
}

// Start server if executed directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createBridgeServer();
  server.listen(PORT, HOST, () => {
    console.log("==================================================");
    console.log("  EVOCK Local Node Bridge");
    console.log(`  Listening on: http://${HOST}:${PORT}`);
    console.log(`  Health Check: http://${HOST}:${PORT}/health`);
    console.log(`  Extract API:  POST http://${HOST}:${PORT}/extract`);
    console.log("==================================================");
  });
}
