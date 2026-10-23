import { createHash, timingSafeEqual } from "node:crypto";
import { DomainError } from "./domain.mjs";
import { StudioStore } from "./studio.mjs";

const schema = properties => ({ type: "object", properties, additionalProperties: false });
const str = { type: "string" };
const int = { type: "integer" };
const RECORD = { artist: str, title: str, releaseYear: int, sourceUrl: str, sourceKind: str, recordingSha256: str, sourceNote: str };
const TOOLS = [
  { name: "studio_projects", description: "List Blossom Studio projects.", inputSchema: schema({}) },
  { name: "studio_project_get", description: "Read News to Song project article, URL and parameters.", inputSchema: { ...schema({ id: str }), required: ["id"] } },
  { name: "studio_project_save_result", description: "Save an original ChatGPT-generated song brief to a Blossom Studio project. Provide concept, lyrics, style, exclusions, moods, titles, coverPrompt, artistPhotoPrompt, suggestedGenre and rationale.", inputSchema: { ...schema({ id: str, result: { type: "object" } }), required: ["id", "result"] }, write: true },
  { name: "spotify_liked_tracks", description: "Read up to 50 private Spotify Liked Songs from the user-authorized Spotify Web API. Requires a separate Spotify OAuth user-library-read grant in local Blossom. Returns metadata only, not audio.", inputSchema: schema({ offset: int, limit: int }) },
  { name: "spotify_liked_import_page", description: "Import one page (up to 50) of user-authorized Spotify Liked Songs into Blossom Music DNA, deduplicating by Spotify track ID and queueing metadata-only references for later verified analysis. Repeat with nextOffset until null.", inputSchema: schema({ offset: int, limit: int }), write: true },
  { name: "music_dna_search", description: "Search the analyzed musical DNA library using indexed text and genre/instrument/mood/vocal filters.",
    inputSchema: schema({ q: str, genre: str, mood: str, instrument: str, vocal: str, limit: int, offset: int }) },
  { name: "music_dna_get", description: "Read a reference recording's latest versioned music DNA analysis.",
    inputSchema: { ...schema({ id: str }), required: ["id"] } },
  { name: "music_dna_versions", description: "List version history of a reference recording's analyses.",
    inputSchema: { ...schema({ id: str }), required: ["id"] } },
  { name: "music_dna_jobs", description: "List persisted bulk-import analysis jobs.",
    inputSchema: schema({ status: str }) },
  { name: "music_dna_add_reference", description: "Create or deduplicate a reference recording. This only saves metadata; it does not claim to have analyzed audio.",
    inputSchema: { ...schema(RECORD), required: ["artist", "title"] }, write: true },
  { name: "music_dna_save_analysis", description: "Save verified music DNA analysis with its provenance, instrument techniques, vocals and timed sections.",
    inputSchema: { ...schema({ id: str, analysis: { type: "object" } }), required: ["id", "analysis"] }, write: true },
  { name: "music_dna_import_batch", description: "Queue up to 500 references for future audio analysis.",
    inputSchema: { ...schema({ items: { type: "array", maxItems: 500, items: { type: "object", properties: RECORD } } }), required: ["items"] }, write: true },
  { name: "music_dna_claim_job", description: "Claim one pending analysis job with a ten minute lease.",
    inputSchema: schema({ worker: str }), write: true },
  { name: "music_dna_complete_job", description: "Complete or mark failed a claimed analysis job; an actual analysis payload is needed for success.",
    inputSchema: { ...schema({ jobId: str, analysis: { type: "object" }, error: str }), required: ["jobId"] }, write: true }
];
const HASH = value => createHash("sha256").update(value).digest();
function authenticated(req, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ") || auth.length > 1024) return false;
  return timingSafeEqual(HASH(auth.slice(7)), HASH(secret));
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "MCP-Protocol-Version": "2025-06-18", ...headers });
  res.end(data == null ? "" : JSON.stringify(data));
}
function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
async function readBody(req) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json"))
    throw new DomainError("Expected application/json", 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256_000) throw new DomainError("MCP request is too large", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("Invalid JSON"); }
}
export class MusicDnaMCP {
  constructor(dna, { readToken = process.env.BLOSSOM_MCP_READ_TOKEN,
    writeToken = process.env.BLOSSOM_MCP_WRITE_TOKEN, oauth = null, spotifyLiked = null } = {}) {
    this.dna = dna;
    this.studio = new StudioStore(dna.store);
    this.readToken = readToken;
    this.writeToken = writeToken;
    this.oauth = oauth;
    this.spotifyLiked = spotifyLiked;
  }
  enabled() { return !!this.oauth?.enabled() || (this.readToken?.length || 0) >= 32 || (this.writeToken?.length || 0) >= 32; }
  async handle(req, res) {
    if (!this.enabled()) return send(res, 404, { error: "MCP is disabled" });
    if (req.method !== "POST") return send(res, 405, { error: "MCP requires POST" });
    const oauthAccess = this.oauth?.verify(req);
    const write = authenticated(req, this.writeToken) || !!oauthAccess?.write;
    const read = write || authenticated(req, this.readToken) || !!oauthAccess?.read;
    if (!read) return send(res, 401, { error: "Bearer authentication required" },
      this.oauth?.enabled() ? this.oauth.challengeHeaders() : {});
    let request;
    try { request = await readBody(req); }
    catch (e) { return send(res, e.status || 400, { error: e.message }); }
    if (Array.isArray(request) || request?.jsonrpc !== "2.0" || typeof request.method !== "string")
      return send(res, 400, errorResponse(null, -32600, "Invalid JSON-RPC request"));
    const { id, method, params = {} } = request;
    // Record just successful OAuth tool discovery, never a token or tool arguments.
    if(oauthAccess && (method==="initialize"||method==="tools/list"))
      this.oauth.record(method==="tools/list"?"tools_listed":"mcp_connected",
        oauthAccess.write?"blossom:read blossom:write":"blossom:read");
    if (id === undefined && method.startsWith("notifications/")) return send(res, 202, null);
    if (id === undefined) return send(res, 400, errorResponse(null, -32600, "Request ID required"));
    try {
      let result;
      if (method === "initialize") {
        result = { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "blossom-music-dna", version: "0.1.0" } };
      } else if (method === "ping") result = {};
      else if (method === "tools/list") result = {
        tools: TOOLS.filter(tool => write || !tool.write)
          .map(({ write: _write, ...tool }) => tool)
      };
      else if (method === "tools/call") {
        const name = params?.name, args = params?.arguments || {};
        const tool = TOOLS.find(item => item.name === name);
        if (!tool || (tool.write && !write)) throw new DomainError("Unknown or unauthorized tool", 403);
        let value;
        switch (name) {
          case "studio_projects": value = this.studio.projects(); break;
          case "studio_project_get": value = this.studio.require(args.id); break;
          case "studio_project_save_result": {
            const result = args.result;
            const required = ["concept","lyrics","style","exclusions","moods","titles","coverPrompt","artistPhotoPrompt","suggestedGenre","rationale"];
            if (!result || required.some(k => !Object.hasOwn(result,k)) ||
                ["concept","lyrics","style","coverPrompt","artistPhotoPrompt","suggestedGenre","rationale"].some(k => typeof result[k] !== "string") ||
                ["exclusions","moods","titles"].some(k => !Array.isArray(result[k]) || result[k].some(v => typeof v !== "string")))
              throw new DomainError("Invalid Studio song brief: required structured fields missing",400);
            value = this.studio.setResult(args.id,result); break;
          }
          case "spotify_liked_tracks":
            if (!this.spotifyLiked) throw new DomainError("Spotify library integration unavailable",503);
            value = await this.spotifyLiked.page(args); break;
          case "spotify_liked_import_page":
            if (!this.spotifyLiked) throw new DomainError("Spotify library integration unavailable",503);
            value = await this.spotifyLiked.importPage(args); break;
          case "music_dna_search": value = this.dna.search(args); break;
          case "music_dna_get": value = this.dna.get(args.id); break;
          case "music_dna_versions": value = this.dna.versions(args.id); break;
          case "music_dna_jobs": value = this.dna.jobs(args.status); break;
          case "music_dna_add_reference": value = this.dna.create(args); break;
          case "music_dna_save_analysis": value = this.dna.saveAnalysis(args.id, args.analysis); break;
          case "music_dna_import_batch": value = this.dna.importBatch(args.items); break;
          case "music_dna_claim_job": value = this.dna.claimJob(args.worker); break;
          case "music_dna_complete_job": value = this.dna.completeJob(args.jobId, args.analysis, args.error); break;
          default: throw new DomainError("Unknown tool", 404);
        }
        result = { content: [{ type: "text", text: JSON.stringify(value) }], isError: false };
      } else return send(res, 200, errorResponse(id, -32601, "Method not found"));
      return send(res, 200, { jsonrpc: "2.0", id, result });
    } catch (err) {
      const code = err instanceof DomainError ? -32602 : -32603;
      return send(res, 200, errorResponse(id, code,
        err instanceof DomainError ? err.message : "Internal server error"));
    }
  }
}
