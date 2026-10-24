import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { id, now, DomainError, artistInput, trackInput, advanceTrack, releaseInput, RELEASE_CHECKS } from "./domain.mjs";
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
export class Store {
  constructor(filename = ":memory:") {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    if (filename !== ":memory:") this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artists (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        genre TEXT NOT NULL, language TEXT NOT NULL, countries TEXT NOT NULL, voice TEXT NOT NULL,
        dna TEXT NOT NULL, identity_verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, artist_id TEXT NOT NULL REFERENCES artists(id),
        title TEXT NOT NULL, mode TEXT NOT NULL, concept TEXT NOT NULL, lyrics TEXT NOT NULL,
        stage TEXT NOT NULL, rights TEXT NOT NULL, audio_ref TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases (id TEXT PRIMARY KEY, track_id TEXT NOT NULL UNIQUE REFERENCES tracks(id),
        external_release_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, checks TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, entity TEXT NOT NULL,
        entity_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS watches (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'baseline_pending',
        checked_at TEXT NOT NULL DEFAULT '', changed_at TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS browser_account_handoffs (
        provider TEXT PRIMARY KEY CHECK(provider IN ('suno','spotify','chatgpt')),
        state TEXT NOT NULL CHECK(state IN ('awaiting_confirmation','user_confirmed','not_confirmed')),
        last_opened_at TEXT NOT NULL DEFAULT '',
        confirmed_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);
  }
  close() { this.db.close(); }
  audit(type, entity, entityId, detail = {}) {
    this.db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?)").run(id(), type, entity, entityId, JSON.stringify(detail), now());
  }
  browserAccountStatus(provider) {
    if(!["suno","spotify","chatgpt"].includes(provider))throw new DomainError("Unsupported browser provider",404);
    const row=this.db.prepare("SELECT * FROM browser_account_handoffs WHERE provider=?").get(provider);
    return row?{state:row.state,lastOpenedAt:row.last_opened_at,
      confirmedAt:row.confirmed_at,updatedAt:row.updated_at}:
      {state:"not_started",lastOpenedAt:"",confirmedAt:"",updatedAt:""};
  }
  setBrowserAccountStatus(provider,action) {
    if(!["suno","spotify","chatgpt"].includes(provider))throw new DomainError("Unsupported browser provider",404);
    if(!["opened","confirmed","not_confirmed"].includes(action))throw new DomainError("Invalid browser handoff action",400);
    const previous=this.browserAccountStatus(provider),time=now();
    const state=action==="opened"?
      (previous.state==="user_confirmed"?"user_confirmed":"awaiting_confirmation"):
      action==="confirmed"?"user_confirmed":"not_confirmed";
    const openedAt=action==="opened"?time:previous.lastOpenedAt;
    // Opening the same website again does not silently revoke a user's earlier
    // self-confirmation. They can explicitly withdraw it if a session expires.
    const confirmedAt=action==="confirmed"?time:
      (action==="opened"&&state==="user_confirmed"?previous.confirmedAt:"");
    this.db.prepare(`INSERT INTO browser_account_handoffs(provider,state,last_opened_at,confirmed_at,updated_at)
      VALUES(?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET
        state=excluded.state,last_opened_at=excluded.last_opened_at,
        confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at`)
      .run(provider,state,openedAt,confirmedAt,time);
    this.audit("browser_handoff_"+action,"connection",provider,{state});
    return this.browserAccountStatus(provider);
  }
  artists() {
    return this.db.prepare("SELECT * FROM artists ORDER BY created_at DESC").all().map(r => ({
      id:r.id,name:r.name,genre:r.genre,language:r.language,countries:parse(r.countries,[]),
      voice:r.voice,dna:r.dna,identityVerified:!!r.identity_verified,createdAt:r.created_at
    }));
  }
  artist(key) { return this.artists().find(a => a.id === key); }
  addArtist(input) {
    const a = { id:id(), ...artistInput(input), createdAt:now() };
    try { this.db.prepare("INSERT INTO artists VALUES(?,?,?,?,?,?,?,?,?)").run(
      a.id,a.name,a.genre,a.language,JSON.stringify(a.countries),a.voice,a.dna,a.identityVerified?1:0,a.createdAt);
    } catch(e) { if(String(e).includes("UNIQUE")) throw new DomainError("Artist name already exists",409); throw e; }
    this.audit("created","artist",a.id,{name:a.name}); return a;
  }
  updateArtist(id, input) {
    if (!this.artist(id)) throw new DomainError("Artist not found", 404);
    const next = artistInput(input);
    try { this.db.prepare("UPDATE artists SET name=?,genre=?,language=?,countries=?,voice=?,dna=?,identity_verified=? WHERE id=?").run(
      next.name,next.genre,next.language,JSON.stringify(next.countries),next.voice,next.dna,next.identityVerified?1:0,id);
    } catch(e) { if(String(e).includes("UNIQUE")) throw new DomainError("Artist name already exists",409); throw e; }
    this.audit("updated","artist",id,{name:next.name});
    return this.artist(id);
  }
  tracks() { return this.db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all().map(r => ({
    id:r.id,artistId:r.artist_id,title:r.title,mode:r.mode,concept:r.concept,lyrics:r.lyrics,
    stage:r.stage,rights:parse(r.rights,{}),audioRef:r.audio_ref,createdAt:r.created_at
  })); }
  track(key) { return this.tracks().find(t => t.id === key); }
  addTrack(input) {
    const t = { id:id(), ...trackInput(input), audioRef:"", createdAt:now() };
    if (!this.artist(t.artistId)) throw new DomainError("Artist not found",404);
    this.db.prepare("INSERT INTO tracks VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      t.id,t.artistId,t.title,t.mode,t.concept,t.lyrics,t.stage,"{}",t.audioRef,t.createdAt);
    this.audit("created","track",t.id,{title:t.title}); return t;
  }
  progressTrack(key, target, rights, audioRef) {
    const t = this.track(key); if (!t) throw new DomainError("Track not found",404);
    const next = advanceTrack(t,target,rights,audioRef);
    this.db.prepare("UPDATE tracks SET stage=?,rights=?,audio_ref=? WHERE id=?").run(
      next.stage,JSON.stringify(next.rights),next.audioRef,key);
    this.audit("stage_changed","track",key,{from:t.stage,to:target}); return next;
  }
  releases() { return this.db.prepare("SELECT * FROM releases ORDER BY created_at DESC").all().map(r => ({
    id:r.id,trackId:r.track_id,externalReleaseId:r.external_release_id,status:r.status,
    checks:parse(r.checks,{}),lastError:r.last_error,createdAt:r.created_at,updatedAt:r.updated_at
  })); }
  release(key) { return this.releases().find(r => r.id === key); }
  addRelease(input) {
    const r = {id:id(),...releaseInput(input,this.track(input?.trackId)),lastError:"",createdAt:now(),updatedAt:now()};
    try { this.db.prepare("INSERT INTO releases VALUES(?,?,?,?,?,?,?,?)").run(
      r.id,r.trackId,r.externalReleaseId,r.status,JSON.stringify(r.checks),r.lastError,r.createdAt,r.updatedAt);
    } catch(e) { if(String(e).includes("UNIQUE")) throw new DomainError("Release or distributor ID already exists",409);throw e; }
    this.audit("created","release",r.id,{trackId:r.trackId}); return r;
  }
  setChecks(key, incoming) {
    const r=this.release(key);if(!r)throw new DomainError("Release not found",404);
    if(r.status!=="draft")throw new DomainError("Checklists can only change for draft releases",409);
    const checks=Object.fromEntries(RELEASE_CHECKS.map(k=>[k,incoming?.[k]===true]));
    this.db.prepare("UPDATE releases SET checks=?,updated_at=? WHERE id=?").run(JSON.stringify(checks),now(),key);
    this.audit("checklist_updated","release",key,checks);return this.release(key);
  }
  setReleaseStatus(key, expected, target, error = "") {
    const result=this.db.prepare("UPDATE releases SET status=?,last_error=?,updated_at=? WHERE id=? AND status=?").run(target,error,now(),key,expected);
    if(!result.changes)throw new DomainError("Release changed or is in an invalid state",409);
    this.audit("status_changed","release",key,{from:expected,to:target,error});return this.release(key);
  }
  events(limit=40) {return this.db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT ?").all(limit).map(r=>({
    id:r.id,type:r.type,entity:r.entity,entityId:r.entity_id,detail:parse(r.detail,{}),createdAt:r.created_at}));}
  summary() {const count=t=>this.db.prepare("SELECT COUNT(*) AS n FROM "+t).get().n;
    return {artists:count("artists"),tracks:count("tracks"),releases:count("releases"),
      approvedTracks:this.db.prepare("SELECT COUNT(*) n FROM tracks WHERE stage='approved'").get().n,
      submittedReleases:this.db.prepare("SELECT COUNT(*) n FROM releases WHERE status='submitted'").get().n,
      unresolvedChanges:this.holds()}; }
  watch(url) {return this.db.prepare("SELECT * FROM watches WHERE url=?").get(url);}
  upsertWatch(url,hash,state,changedAt="") {
    this.db.prepare(`INSERT INTO watches(id,url,hash,state,checked_at,changed_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET
      hash=excluded.hash,state=excluded.state,checked_at=excluded.checked_at,
      changed_at=excluded.changed_at`).run(id(),url,hash,state,now(),changedAt);
  }
  watches() {return this.db.prepare("SELECT * FROM watches ORDER BY url").all();}
  holds() {return this.db.prepare("SELECT COUNT(*) n FROM watches WHERE state='changed'").get().n;}
  acknowledgeWatch(watchId) {
    const r=this.db.prepare("UPDATE watches SET state='acknowledged' WHERE id=? AND state='changed'").run(watchId);
    if(!r.changes)throw new DomainError("Unresolved watch not found",404);
    this.audit("acknowledged","watch",watchId);return this.watches();
  }
}
