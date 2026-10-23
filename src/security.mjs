import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { DomainError } from "./domain.mjs";

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const digest = input => createHash("sha256").update(input).digest("hex");
const hashPassword = (value,user) => scryptSync(value,"blossom-admin-v2:"+user,32);
export const sessionCookieName = "blossom_session";
export const encodeCookie = (token,secure=false) => `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TOKEN_TTL_MS/1000}${secure?"; Secure":""}`;
export const expireCookie = secure => `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure?"; Secure":""}`;
export function cookieValue(req) {
  const header = req.headers.cookie ?? "";
  const cookie=header.split(";").map(s=>s.trim()).find(s=>s.startsWith(sessionCookieName+"="));
  const token=cookie?.slice(sessionCookieName.length+1) || "";
  return /^[A-Za-z0-9_-]{32,128}$/.test(token)?token:null;
}

export class Sessions {
  constructor(db, { username="admin", password }={}) {
    if(typeof password!=="string"||password.length<12)throw Error("BLOSSOM_ADMIN_PASSWORD must contain at least 12 characters");
    if(!/^[a-zA-Z][a-zA-Z0-9._-]{2,60}$/.test(username))throw Error("Invalid admin username");
    this.db=db;this.username=username;
    this.passwordHash=hashPassword(password,username);
    this.attempts=new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS web_sessions
      (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_pending
      (state_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL, verifier_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
  }
  login(username,password,ip="unknown") {
    const time=Date.now(),record=this.attempts.get(ip);
    if(record && time<record.until && record.count>=7)throw new DomainError("Too many attempts. Try again later.",429);
    const good=typeof username==="string"&&username===this.username&&typeof password==="string"&&password.length<=1024 &&
      timingSafeEqual(hashPassword(password,this.username),this.passwordHash);
    if(!good) {
      const next=record&&time<record.until?record:{count:0,until:time+15*60*1000};
      next.count++;this.attempts.set(ip,next);
      throw new DomainError("Invalid username or password",401);
    }
    this.attempts.delete(ip);
    const token=randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO web_sessions VALUES (?,?)").run(digest(token),time+TOKEN_TTL_MS);
    this.db.prepare("DELETE FROM web_sessions WHERE expires_at < ?").run(time);
    return token;
  }
  session(req) {
    const token=cookieValue(req);
    if(!token)return null;
    const row=this.db.prepare("SELECT expires_at FROM web_sessions WHERE token_hash=?").get(digest(token));
    return row?.expires_at>Date.now()?digest(token):null;
  }
  logout(req) {
    const token=cookieValue(req);
    if(token)this.db.prepare("DELETE FROM web_sessions WHERE token_hash=?").run(digest(token));
  }
  saveOAuth(state,sessionHash,encryptedVerifier) {
    this.db.prepare("INSERT INTO oauth_pending VALUES (?,?,?,?)").run(digest(state),sessionHash,encryptedVerifier,Date.now()+10*60*1000);
  }
  consumeOAuth(state,sessionHash) {
    const transaction=this.db.transaction ? this.db.transaction.bind(this.db) : null;
    // DELETE first makes callbacks one-time, including token-exchange failures.
    const row=this.db.prepare("SELECT * FROM oauth_pending WHERE state_hash=? AND session_hash=?").get(digest(state),sessionHash);
    if(!row)return null;
    this.db.prepare("DELETE FROM oauth_pending WHERE state_hash=?").run(digest(state));
    return row.expires_at>Date.now()?row.verifier_cipher:null;
  }
}
export class Vault {
  constructor(db,base64Key) {
    this.db=db;this.key=null;
    if(base64Key) {
      if(!/^(?:[A-Za-z0-9+/]{4}){10}(?:[A-Za-z0-9+/]{3}=)$/.test(base64Key)||Buffer.from(base64Key,"base64").length!==32)
        throw Error("BLOSSOM_VAULT_KEY must be a base64-encoded 32-byte key");
      this.key=Buffer.from(base64Key,"base64");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS credentials
      (name TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '', ciphertext TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  requireKey() {if(!this.key)throw new DomainError("Credential vault is locked: configure BLOSSOM_VAULT_KEY",503);}
  encrypt(name,plaintext) {
    this.requireKey();const nonce=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",this.key,nonce);
    cipher.setAAD(Buffer.from("blossom:v1:"+name));
    const payload=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);
    return ["v1",nonce.toString("base64url"),cipher.getAuthTag().toString("base64url"),payload.toString("base64url")].join(".");
  }
  decrypt(name,data) {
    this.requireKey();
    try {
      const [version,iv,tag,payload]=data.split(".");
      if(version!=="v1")throw Error("Unsupported version");
      const decipher=createDecipheriv("aes-256-gcm",this.key,Buffer.from(iv,"base64url"));
      decipher.setAAD(Buffer.from("blossom:v1:"+name));
      decipher.setAuthTag(Buffer.from(tag,"base64url"));
      return Buffer.concat([decipher.update(Buffer.from(payload,"base64url")),decipher.final()]).toString("utf8");
    }catch{throw new DomainError("Saved secret cannot be decrypted. Check BLOSSOM_VAULT_KEY",503);}
  }
  save(name,label,value) {
    if(!["suno_api_key","spotify_refresh_token"].includes(name))throw new DomainError("Unsupported credential type");
    if(typeof value!=="string" || !value.trim() || value.length>8192)throw new DomainError("Invalid credential");
    if(typeof label!=="string"||label.length>200)throw new DomainError("Account label too long");
    const encrypted=this.encrypt(name,value.trim());
    this.db.prepare(`INSERT INTO credentials VALUES(?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET label=excluded.label,ciphertext=excluded.ciphertext,updated_at=excluded.updated_at`).run(
        name,label.trim(),encrypted,new Date().toISOString());
  }
  read(name) {
    const row=this.db.prepare("SELECT ciphertext FROM credentials WHERE name=?").get(name);
    return row?this.decrypt(name,row.ciphertext):null;
  }
  delete(name) {
    if(!["suno_api_key","spotify_refresh_token"].includes(name))throw new DomainError("Unsupported credential type");
    this.db.prepare("DELETE FROM credentials WHERE name=?").run(name);
  }
  list() {
    const result={vaultReady:!!this.key};
    for(const name of ["suno_api_key","spotify_refresh_token"]) {
      const row=this.db.prepare("SELECT label,updated_at FROM credentials WHERE name=?").get(name);
      result[name]={configured:!!row,label:row?.label||"",updatedAt:row?.updated_at||null};
    }
    result.spotifyClientId=this.getSetting("spotify_client_id")||"";
    result.sunoEmail=this.getSetting("suno_email")||"";
    return result;
  }
  setSetting(key,value){
    if(!["spotify_client_id","suno_email"].includes(key))throw new DomainError("Unsupported setting");
    if(typeof value!=="string"||value.length>254)throw new DomainError("Invalid setting");
    if(key==="spotify_client_id" && value && !/^[a-f0-9]{32}$/i.test(value))throw new DomainError("Spotify Client ID must be 32 hexadecimal characters");
    if(key==="suno_email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new DomainError("Invalid email");
    this.db.prepare("INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value);
  }
  getSetting(key){return this.db.prepare("SELECT value FROM settings WHERE key=?").get(key)?.value || "";}
}
