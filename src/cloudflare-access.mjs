import { createPublicKey, verify } from "node:crypto";

// Validate Cloudflare Access at the origin, not just at the proxy edge.
// A forwarded header or cookie is not evidence of authentication until the
// RS256 signature, audience, issuer and token validity have been checked.
export class CloudflareAccess {
  constructor({
    teamDomain = process.env.BLOSSOM_CF_ACCESS_TEAM_DOMAIN || "",
    audience = process.env.BLOSSOM_CF_ACCESS_AUD || "",
    fetcher = fetch
  } = {}) {
    const host = teamDomain.replace(/^https:\/\//i, "").replace(/\/$/, "").toLowerCase();
    if (host && !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(host))
      throw Error("BLOSSOM_CF_ACCESS_TEAM_DOMAIN must be a Cloudflare Access team domain");
    if (audience && (typeof audience !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(audience)))
      throw Error("BLOSSOM_CF_ACCESS_AUD must be a Cloudflare Access application audience tag");
    this.issuer = host ? "https://" + host : "";
    this.audience = audience;
    this.fetcher = fetcher;
    this.keys = [];
    this.expiration = 0;
  }
  configured() { return !!(this.issuer && this.audience); }
  async loadKeys() {
    if (Date.now() < this.expiration && this.keys.length) return this.keys;
    const response = await this.fetcher(this.issuer + "/cdn-cgi/access/certs", {
      signal: AbortSignal.timeout(5000), headers: {accept: "application/json"}
    });
    if (!response.ok) throw Error("Cloudflare Access JWKS unavailable");
    const data = await response.json();
    if (!Array.isArray(data.keys) || data.keys.length < 1 || data.keys.length > 20)
      throw Error("Invalid Cloudflare Access JWKS");
    const keys = data.keys.filter(k => k.kty === "RSA" && k.n && k.e &&
      typeof k.kid === "string" && (!k.alg || k.alg === "RS256") &&
      (!k.use || k.use === "sig"));
    if (!keys.length) throw Error("Missing RSA signing keys in Cloudflare Access JWKS");
    this.keys = keys;
    this.expiration = Date.now() + 5*60*1000;
    return keys;
  }
  async verifyRequest(req) {
    if (!this.configured()) return false;
    const token = req.headers["cf-access-jwt-assertion"];
    if (typeof token !== "string" || token.length > 8192) return false;
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return false;
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch { return false; }
    if (header.alg !== "RS256" || typeof header.kid !== "string" ||
        claims.iss !== this.issuer ||
        ![claims.aud].flat().includes(this.audience)) return false;
    const now = Math.floor(Date.now()/1000);
    if (!Number.isInteger(claims.exp) || claims.exp <= now ||
        !Number.isInteger(claims.iat) || claims.iat > now + 60 ||
        (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now)))
      return false;
    try {
      let keys = await this.loadKeys();
      let candidate = keys.find(k => k.kid === header.kid);
      if (!candidate) { this.expiration = 0; keys = await this.loadKeys(); candidate = keys.find(k => k.kid === header.kid); }
      if (!candidate) return false;
      const key = createPublicKey({key:candidate,format:"jwk"});
      return verify("RSA-SHA256", Buffer.from(parts[0]+"."+parts[1]),
        key, Buffer.from(parts[2],"base64url"));
    } catch { return false; }
  }
}
