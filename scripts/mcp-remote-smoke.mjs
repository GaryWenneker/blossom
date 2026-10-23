#!/usr/bin/env node
// Public smoke test of Blossom's real ChatGPT MCP OAuth routing.
// No administrator credentials, bearer secrets, or writable grants are used.
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

const base = (process.argv[2] || process.env.BLOSSOM_MCP_PUBLIC_URL || "").replace(/\/$/, "");
if (!/^https:\/\/[a-z0-9.-]+(?::443)?$/i.test(base)) {
  console.error("Usage: node scripts/test-mcp-remote.mjs https://blossom.wenneker.dev");
  process.exit(2);
}
const resource = base + "/mcp";
const callback = "https://chatgpt.com/connector_platform_oauth_redirect";
const timeout = 15_000;
const state = randomBytes(16).toString("base64url");
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
let step = "initialization";

async function call(path, init = {}) {
  const response = await fetch(base + path, {
    ...init, redirect: "manual",
    signal: AbortSignal.timeout(timeout),
    headers: { "user-agent": "blossom-mcp-oauth-smoke/1.0", ...(init.headers || {}) }
  });
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  if (response.status >= 300 && response.status < 400 && !response.headers.get("location")) {
    throw Error("Unexpected redirect without Location on " + path);
  }
  if ((response.status === 200 || response.status === 201) &&
      !contentType.includes("json") && !contentType.includes("html")) {
    throw Error(path + " returned " + contentType + " rather than a Blossom OAuth response");
  }
  return { response, body, contentType };
}
function expectStatus(result, expected) {
  if (result.response.status !== expected) {
    throw Error("Expected HTTP " + expected + " but received " +
      result.response.status + " (" + result.contentType + "): " +
      result.body.slice(0, 300).replace(/\s+/g, " "));
  }
}
function json(result) {
  if (!result.contentType.includes("application/json")) {
    const start = result.body.toLowerCase().indexOf("<title");
    const tagEnd = start < 0 ? -1 : result.body.indexOf(">", start);
    const title = tagEnd < 0 ? "(no HTML title)" : result.body.slice(tagEnd + 1, tagEnd + 150).split("<")[0];
    const server = result.response.headers.get("server") || "(unknown)";
    const ray = result.response.headers.get("cf-ray") || "(none)";
    const mitigation = result.response.headers.get("cf-mitigated") || "(none)";
    throw Error("Expected OAuth JSON; received " + result.response.status +
      " " + result.contentType + "; page title: " + title +
      "; server: " + server + "; cf-ray: " + ray +
      "; cf-mitigated: " + mitigation + "; body: " +
      result.body.slice(0, 280).replace(/\s+/g, " "));
  }
  return JSON.parse(result.body);
}
try {
  step = "authorization discovery";
  const discovery = await call("/.well-known/oauth-authorization-server");
  expectStatus(discovery, 200);
  const metadata = json(discovery);
  assert.equal(metadata.issuer, base);
  assert.equal(metadata.authorization_endpoint, base + "/oauth/authorize");
  assert.equal(metadata.registration_endpoint, base + "/oauth/register");
  assert.equal(metadata.token_endpoint, base + "/oauth/token");
  console.log("PASS OAuth discovery");

  step = "protected resource metadata";
  const protectedResource = await call("/.well-known/oauth-protected-resource");
  expectStatus(protectedResource, 200);
  assert.equal(json(protectedResource).resource, resource);
  console.log("PASS MCP resource discovery");

  step = "unauthenticated MCP challenge";
  const unauthorized = await call("/mcp", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  expectStatus(unauthorized, 401);
  assert.match(unauthorized.response.headers.get("www-authenticate") || "", /oauth-protected-resource/);
  console.log("PASS MCP authentication challenge");

  step = "client registration";
  const register = await call("/oauth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [callback], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"]
    })
  });
  expectStatus(register, 201);
  const client = json(register);
  assert.ok(client.client_id?.startsWith("blossom_"));
  console.log("PASS ChatGPT OAuth client registration");

  step = "authorize page and pending consent persistence";
  const params = new URLSearchParams({
    response_type: "code", client_id: client.client_id,
    redirect_uri: callback, code_challenge: challenge, code_challenge_method: "S256",
    state, resource, scope: "blossom:read blossom:write offline_access"
  });
  const consent = await call("/oauth/authorize?" + params);
  expectStatus(consent, 200);
  assert.ok(consent.contentType.includes("text/html"));
  const nonce = consent.body.match(/name="request" value="([^"]+)"/)?.[1];
  assert.ok(nonce && /^[A-Za-z0-9_-]{32,128}$/.test(nonce),
    "Consent form did not contain a signed pending request");
  console.log("PASS consent page");

  step = "consent POST (deny, no password)";
  const deny = await call("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
    body: new URLSearchParams({ request: nonce, decision: "deny" })
  });
  expectStatus(deny, 303);
  const location = new URL(deny.response.headers.get("location"));
  assert.equal(location.origin, "https://chatgpt.com");
  assert.equal(location.pathname, new URL(callback).pathname);
  assert.equal(location.searchParams.get("state"), state);
  assert.equal(location.searchParams.get("error"), "access_denied");
  console.log("PASS OAuth pending request survived GET -> POST through public route");
  console.log("PASS ChatGPT callback redirect");

  step = "one-time-use validation";
  const replay = await call("/oauth/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
    body: new URLSearchParams({ request: nonce, decision: "deny" })
  });
  if (replay.response.status === 400 &&
      replay.contentType.includes("application/json") &&
      json(replay).error_description === "Approval expired") {
    console.warn("WARN: Live server still runs the old consent-replay handler. Deploy the merged OAuth fix on the Mac.");
  } else {
    expectStatus(replay, 200);
    assert.ok(replay.contentType.includes("text/html"));
    assert.match(replay.body, /Toestemming al verwerkt/);
    console.log("PASS duplicate form submission handled safely");
  }

  console.log("SUCCESS: Public Blossom MCP OAuth consent routing is consistent.");
} catch (error) {
  console.error("FAIL at " + step + ": " + error.message);
  console.error("Check Cloudflare routing for /.well-known/*, /oauth/* and /mcp, then ensure all three point to the same persistent Blossom database.");
  process.exitCode = 1;
}
