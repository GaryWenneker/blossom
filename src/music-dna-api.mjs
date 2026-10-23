import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateAudio, MAX_REFERENCE_AUDIO_BYTES } from "./music-audio.mjs";
import { DomainError } from "./domain.mjs";

function respond(res, status, result) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(result));
}
async function jsonBody(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json"))
    throw new DomainError("Expected application/json", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256_000) throw new DomainError("JSON payload too large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("Invalid JSON payload"); }
}

export class MusicDnaAPI {
  constructor(dna, { audioDir = process.env.BLOSSOM_REFERENCE_AUDIO_DIR || ".data/reference-audio" } = {}) {
    this.dna = dna;
    this.audioDir = audioDir;
  }
  async handle(req, res, path, searchParams) {
    const method = req.method;
    if (method === "GET") {
      if (path === "/api/music-dna/search") {
        const filters = {};
        for (const name of ["q", "genre", "mood", "instrument", "vocal"])
          filters[name] = searchParams.get(name) || "";
        for (const name of ["limit", "offset"]) {
          if (searchParams.has(name)) {
            const value = searchParams.get(name);
            if (!/^\d+$/.test(value)) throw new DomainError("Invalid " + name);
            filters[name] = Number(value);
          }
        }
        return respond(res, 200, { results: this.dna.search(filters) });
      }
      if (path === "/api/music-dna/jobs") {
        return respond(res, 200, { jobs: this.dna.jobs(searchParams.get("status") || "") });
      }
      const profileMatch = path.match(/^\/api\/music-dna\/profiles\/([0-9a-f-]{36})(?:\/(versions))?$/i);
      if (profileMatch) return respond(res, 200,
        profileMatch[2] ? { versions: this.dna.versions(profileMatch[1]) } : this.dna.get(profileMatch[1]));
      throw new DomainError("Not found", 404);
    }
    if (method !== "POST") throw new DomainError("Method not allowed", 405);
    const upload = path.match(/^\/api\/music-dna\/profiles\/([0-9a-f-]{36})\/upload-audio$/i);
    if (upload) {
      this.dna.get(upload[1]);
      if (req.headers["x-blossom-audio-rights"] !== "confirmed")
        throw new DomainError("Explicit permission to process this reference audio is required", 403);
      const mime = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!["audio/mpeg", "audio/wav", "audio/x-wav"].includes(mime))
        throw new DomainError("MP3 or WAV required", 415);
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_REFERENCE_AUDIO_BYTES)
          throw new DomainError("Reference audio exceeds 40MB", 413);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const info = validateAudio(bytes, mime);
      const existing = this.dna.audioForProfile(upload[1]);
      if (existing) {
        if (existing.sha256 !== info.sha256)
          throw new DomainError("Different audio is already associated with this reference", 409);
        return respond(res, 200, { ...existing, duplicate: true });
      }
      await mkdir(this.audioDir, { recursive: true, mode: 0o700 });
      const filename = randomUUID() + "." + info.extension, location = join(this.audioDir, filename);
      await writeFile(location, bytes, { flag: "wx", mode: 0o600 });
      let asset;
      try {
        asset = this.dna.attachAudio(upload[1],
          { ...info, filename, rightsConfirmed: true });
      } catch (error) {
        await rm(location, { force: true });
        throw error;
      }
      return respond(res, 201, asset);
    }
    const body = await jsonBody(req);
    if (path === "/api/music-dna/profiles") return respond(res, 201, this.dna.create(body));
    if (path === "/api/music-dna/import-batch")
      return respond(res, 201, { items: this.dna.importBatch(body?.items) });
    if (path === "/api/music-dna/jobs/claim")
      return respond(res, 200, { job: this.dna.claimJob(body?.worker) });
    const save = path.match(/^\/api\/music-dna\/profiles\/([0-9a-f-]{36})\/analyses$/i);
    if (save) return respond(res, 201, this.dna.saveAnalysis(save[1], body));
    const complete = path.match(/^\/api\/music-dna\/jobs\/([0-9a-f-]{36})\/complete$/i);
    if (complete) return respond(res, 200, this.dna.completeJob(complete[1], body?.analysis, body?.error));
    throw new DomainError("Not found", 404);
  }
}
