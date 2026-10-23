import { randomBytes, createHash, randomUUID } from "node:crypto";

const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
export const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const RESOURCE = "https://api.openai.com/v1";
export const REQUIRED_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

export function createHostId() {
  return "urn:uuid:" + randomUUID();
}

export function createAuthorization({ hostId, clientId, port = 1455, name = "Blossom" }) {
  if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId || "")) throw new Error("Persistent host ID required");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid loopback port");
  if (clientId && !/^oaiapp_[a-zA-Z0-9_-]+$/.test(clientId)) throw new Error("Invalid issued client ID");
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const url = new URL(AUTHORIZE_URL);
  const params = {
    client_id: clientId || "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: REQUIRED_SCOPES,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url")
  };
  if (!clientId) params.agent_name_hint = name;
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { url: url.toString(), state, nonce, verifier, redirectUri, clientId: clientId || null };
}

export function validateCallback(query, pending) {
  if (!pending || !query || query.state !== pending.state) throw new Error("OAuth state mismatch");
  if (query.error) throw new Error("OAuth authorization rejected");
  if (!query.code || typeof query.code !== "string") throw new Error("Missing authorization code");
  const issuedClientId = query.client_id || pending.clientId;
  if (!issuedClientId || !/^oaiapp_[a-zA-Z0-9_-]+$/.test(issuedClientId)) throw new Error("Missing issued client ID");
  if (pending.clientId && issuedClientId !== pending.clientId) throw new Error("OAuth client ID mismatch");
  return { code: query.code, clientId: issuedClientId };
}

export function tokenExchangeBody({ code, clientId, verifier, redirectUri }) {
  if (!code || !clientId || !verifier || !redirectUri) throw new Error("Incomplete token exchange");
  return new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource: RESOURCE
  });
}

export function hasPlanPermission(scopes) {
  return (Array.isArray(scopes) ? scopes : String(scopes || "").split(/\\s+/)).includes("chatgpt.tokens.use.direct");
}
