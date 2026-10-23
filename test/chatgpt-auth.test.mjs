import test from "node:test";
import assert from "node:assert/strict";
import { createAuthorization, createHostId, validateCallback, tokenExchangeBody, hasPlanPermission } from "../src/chatgpt-auth.mjs";

test("dynamic registration uses loopback, PKCE, state and required scopes", () => {
  const auth = createAuthorization({ hostId: createHostId() });
  const url = new URL(auth.url);
  assert.equal(url.hostname, "auth.openai.com");
  assert.equal(url.searchParams.get("client_id"), "dynamic_agent_client");
  assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:1455/auth/callback");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), auth.state);
  assert.ok(url.searchParams.get("scope").includes("chatgpt.tokens.use.direct"));
  assert.notEqual(createAuthorization({ hostId: createHostId() }).state, auth.state);
});

test("callback rejects state mismatch and missing issued client ID", () => {
  const pending = createAuthorization({ hostId: createHostId() });
  assert.throws(() => validateCallback({ state: "wrong", code: "abc" }, pending));
  assert.throws(() => validateCallback({ state: pending.state, code: "abc" }, pending));
  const valid = validateCallback({ state: pending.state, code: "abc", client_id: "oaiapp_example" }, pending);
  assert.equal(valid.clientId, "oaiapp_example");
  const body = tokenExchangeBody({ ...valid, verifier: pending.verifier, redirectUri: pending.redirectUri });
  assert.equal(body.get("resource"), "https://api.openai.com/v1");
  assert.equal(body.get("code_verifier"), pending.verifier);
});

test("plan usage requires granted scope", () => {
  assert.equal(hasPlanPermission("openid profile"), false);
  assert.equal(hasPlanPermission("openid chatgpt.tokens.use.direct"), true);
  assert.equal(hasPlanPermission("openid\tprofile\nchatgpt.tokens.use.direct"), true);
  assert.equal(hasPlanPermission(["openid", "chatgpt.tokens.use.direct"]), true);
});
