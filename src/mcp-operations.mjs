import { DomainError, ensureReleaseReady } from "./domain.mjs";
import { Discography } from "./discography.mjs";
import { GENRES } from "./genres.mjs";

const str = { type: "string" };
const int = { type: "integer" };
const obj = { type: "object" };

function schema(properties, required = []) {
  const result = { type: "object", properties, additionalProperties: false };
  if (required.length) result.required = required;
  return result;
}

export const WITHHELD = [
  { name: "credentials", reason: "API keys, passwords, OAuth tokens and cookies stay in the local vault. ChatGPT cannot read or write them." },
  { name: "browser_automation", reason: "Opening Safari or driving the Suno, Spotify or ChatGPT websites remains a manual handoff on this Mac." },
  { name: "binary_media", reason: "Audio and image bytes are not accepted over MCP. Upload those in local Studio." },
  { name: "website_lyrics", reason: "A signed-in ChatGPT website tab is not a headless API. Save a structured brief or use studio_compose_local." },
  { name: "gateway_admin", reason: "OAuth diagnostics, Cloudflare and the public gateway are not adjustable from ChatGPT." }
];

function rejectSecrets(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return;
  const entries = Object.entries(value);
  if (entries.length > 40) throw new DomainError("Input is too large", 400);
  for (const [key, child] of entries) {
    if (/apiKey|password|token|secret|cookie|authorization|verifier/i.test(key))
      throw new DomainError("MCP cannot accept credentials", 403);
    rejectSecrets(child, depth + 1);
  }
}

function requireKey(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 200 || /[\\/]/.test(value))
    throw new DomainError("Invalid " + label, 400);
  return value;
}

function integer(value, label, min, max, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DomainError("Invalid " + label, 400);
  return value;
}

function need(ctx, key, label) {
  if (!ctx[key]) throw new DomainError(label + " is unavailable", 503);
  return ctx[key];
}

function catalogOf(ctx) {
  if (ctx.catalog) return ctx.catalog;
  if (!ctx.store || !ctx.studio) throw new DomainError("Catalog is unavailable", 503);
  ctx.catalog = new Discography(ctx.store, ctx.studio);
  return ctx.catalog;
}

function pageOptions(input) {
  return {
    limit: integer(input.limit, "limit", 1, 100, 50),
    cursor: input.cursor ? requireKey(input.cursor, "cursor") : ""
  };
}

function releaseBundle(store, id) {
  const release = store.release(requireKey(id, "release id"));
  if (!release) throw new DomainError("Release not found", 404);
  return { release, track: store.track(release.trackId) };
}

function distributorOk(data) {
  if (data?.valid === false || data?.success === false || (Array.isArray(data?.errors) && data.errors.length > 0))
    throw new DomainError("Distributor validation returned errors. Resolve them before approval.", 409);
}

const OPERATIONS = [
  op("label_summary", "Count artists, tracks, releases and unresolved compliance holds.", false, schema({}),
    ctx => ctx.store.summary()),
  op("artists_list", "List label artists.", false, schema({}),
    ctx => ctx.store.artists()),
  op("artist_create", "Create a label artist. Identity stays unverified until a person confirms it.", true,
    schema({ name: str, genre: str, language: str, countries: { type: "array", items: str }, voice: str, dna: str }, ["name", "genre", "dna"]),
    (ctx, input) => ctx.store.addArtist(input)),
  op("artists_reorder", "Set the exact artist order. ids must be a permutation of every artist.", true,
    schema({ ids: { type: "array", items: str } }, ["ids"]),
    (ctx, input) => ctx.store.reorderArtists(input.ids)),
  op("tracks_list", "List label tracks.", false, schema({}), ctx => ctx.store.tracks()),
  op("track_create", "Create a track in the idea stage.", true,
    schema({ artistId: str, title: str, mode: str, concept: str, lyrics: str }, ["artistId", "title", "mode", "concept"]),
    (ctx, input) => ctx.store.addTrack(input)),
  op("track_advance", "Move a track along the documented stage machine.", true,
    schema({ id: str, target: str, rights: obj, audioRef: str }, ["id", "target"]),
    (ctx, input) => ctx.store.progressTrack(requireKey(input.id, "track id"), input.target, input.rights, input.audioRef)),
  op("releases_list", "List distributor releases.", false, schema({}), ctx => ctx.store.releases()),
  op("release_create", "Draft a release for an approved track.", true,
    schema({ trackId: str, externalReleaseId: str }, ["trackId", "externalReleaseId"]),
    (ctx, input) => ctx.store.addRelease(input)),
  op("release_set_checks", "Set the draft release checklist. Omitted checks are false.", true,
    schema({ id: str, checks: obj }, ["id", "checks"]),
    (ctx, input) => ctx.store.setChecks(requireKey(input.id, "release id"), input.checks)),
  op("release_validate", "Ask the configured distributor to validate a draft release.", true,
    schema({ id: str }, ["id"]),
    async (ctx, input) => {
      const provider = need(ctx, "provider", "Distributor");
      const { release } = releaseBundle(ctx.store, input.id);
      if (release.status !== "draft") throw new DomainError("Release is not a draft", 409);
      const providerResponse = await provider.validate(release.externalReleaseId);
      distributorOk(providerResponse);
      ctx.store.setReleaseStatus(release.id, "draft", "validated");
      return { release: ctx.store.release(release.id), providerResponse };
    }),
  op("release_approve", "Approve a release that the distributor already validated.", true,
    schema({ id: str }, ["id"]),
    (ctx, input) => {
      const { release, track } = releaseBundle(ctx.store, input.id);
      ensureReleaseReady(release, track, ctx.store.holds());
      if (release.status !== "validated") throw new DomainError("Validate with distributor first", 409);
      return ctx.store.setReleaseStatus(release.id, "validated", "approved");
    }),
  op("release_distribute", "Submit an approved release. Requires live distribution to be enabled and confirmation PUBLISH.", true,
    schema({ id: str, confirmation: str }, ["id", "confirmation"]),
    async (ctx, input) => {
      if (input.confirmation !== "PUBLISH") throw new DomainError("Explicit PUBLISH confirmation required", 409);
      if (!ctx.allowLive) throw new DomainError("Live distribution is disabled in server settings", 403);
      const provider = need(ctx, "provider", "Distributor");
      const { release, track } = releaseBundle(ctx.store, input.id);
      ensureReleaseReady(release, track, ctx.store.holds());
      if (release.status !== "approved") throw new DomainError("Release must be approved", 409);
      ctx.store.setReleaseStatus(release.id, "approved", "submitting");
      try {
        const providerResponse = await provider.distribute(release.externalReleaseId);
        distributorOk(providerResponse);
        return { release: ctx.store.setReleaseStatus(release.id, "submitting", "submitted"), providerResponse };
      } catch (err) {
        if (err instanceof DomainError) throw err;
        ctx.store.setReleaseStatus(release.id, "submitting", "needs_reconciliation", String(err.message || err).slice(0, 250));
        throw new DomainError("Submission outcome unknown. Reconcile with LabelGrid before retrying. " + String(err.message || err), 502);
      }
    }),
  op("events_list", "Read the recent audit events.", false, schema({ limit: int }),
    (ctx, input) => ctx.store.events(integer(input.limit, "limit", 1, 100, 40))),
  op("genres_list", "Read the editorial genre taxonomy.", false, schema({}), () => GENRES),
  op("watches_list", "List compliance-watch records.", false, schema({}), ctx => ctx.store.watches()),
  op("watch_acknowledge", "Acknowledge one compliance watch that is in the changed state.", true,
    schema({ id: str }, ["id"]),
    (ctx, input) => ctx.store.acknowledgeWatch(requireKey(input.id, "watch id"))),
  op("browser_handoff", "Read manual browser handoff markers. user_confirmed is a person's confirmation, not a live website session.", false, schema({}),
    ctx => Object.fromEntries(["suno", "spotify", "chatgpt"].map(provider => [provider, ctx.store.browserAccountStatus(provider)]))),
  op("connections_status", "Read which connections exist. Values are labels and configured flags, never secrets.", false, schema({}),
    ctx => ctx.vault ? ctx.vault.list() : { vaultReady: false }),
  op("integrations_status", "Read whether distribution and Suno are configured, without secrets.", false, schema({}),
    ctx => ({
      labelgrid: ctx.provider?.available?.() ? "token configured" : "not configured",
      liveDistributionEnabled: !!ctx.allowLive,
      suno: "official API when a key is stored locally; MCP never reads the key"
    })),
  op("studio_inventory", "Summarize Studio projects and assets.", false, schema({}),
    ctx => need(ctx, "studio", "Studio").inventory()),
  op("studio_project_page", "Page Studio projects.", false, schema({ limit: int, cursor: str, q: str }),
    (ctx, input) => {
      const studio = need(ctx, "studio", "Studio");
      const page = studio.projectPage({ ...pageOptions(input), q: typeof input.q === "string" ? input.q : "" });
      return { ...page, results: page.results.map(project => ({ ...project, sunoJob: studio.sunoJob(project.id) })) };
    }),
  op("studio_project_history", "Read Studio project revisions.", false, schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studio", "Studio").history(requireKey(input.id, "project id"))),
  op("studio_project_takes", "List Suno takes stored for a Studio project.", false, schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studio", "Studio").sunoJobs(requireKey(input.id, "project id"))),
  op("studio_project_assets", "List Studio asset metadata. Bytes stay on local Studio.", false, schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studio", "Studio").assets(requireKey(input.id, "project id"))),
  op("studio_project_references", "Read Music DNA references linked to a Studio project.", false, schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studioApi", "Studio").referencePayload(requireKey(input.id, "project id"))),
  op("studio_project_create", "Create or update a Studio project draft.", true, schema({
    id: str, requestId: str, title: str, article: str, sourceUrl: str, artistId: str, parameters: obj, expectedRevision: int
  }), (ctx, input) => need(ctx, "studio", "Studio").save(input)),
  op("studio_project_patch", "Patch Studio project fields with the expected revision.", true,
    schema({ id: str, changes: obj, expectedRevision: int, baseValues: obj }, ["id", "changes"]),
    (ctx, input) => need(ctx, "studio", "Studio").patch(requireKey(input.id, "project id"), input.changes, {
      expectedRevision: input.expectedRevision, baseValues: input.baseValues
    })),
  op("studio_references_set", "Replace the Music DNA references linked to a Studio project.", true,
    schema({ id: str, references: { type: "array" } }, ["id", "references"]),
    (ctx, input) => {
      const api = need(ctx, "studioApi", "Studio");
      const id = requireKey(input.id, "project id");
      api.references.set(id, input.references);
      return api.referencePayload(id);
    }),
  op("studio_preset_save", "Save Suno parameter defaults for one artist.", true,
    schema({ artistId: str, preset: obj }, ["artistId", "preset"]),
    (ctx, input) => need(ctx, "studio", "Studio").savePreset(requireKey(input.artistId, "artist id"), input.preset)),
  op("studio_artist_presets", "Read saved Suno parameter defaults for every artist.", false, schema({}),
    ctx => Object.fromEntries(ctx.store.artists().map(artist => [artist.id, need(ctx, "studio", "Studio").preset(artist.id)]))),
  op("studio_presets", "Read the built-in Studio length presets.", false, schema({}),
    ctx => need(ctx, "studioApi", "Studio").presets()),
  op("studio_status", "Read which Studio generators are configured, without secrets.", false, schema({}),
    async ctx => {
      if (ctx.studioApi) return ctx.studioApi.statusSnapshot();
      const list = ctx.vault?.list?.() || {};
      return {
        openaiConfigured: !!list.openai_api_key?.configured,
        sunoApiConfigured: !!list.suno_api_key?.configured,
        spotifyConfigured: !!list.spotify_refresh_token?.configured
      };
    }),
  op("studio_article_import", "Import article text from an http(s) URL through the local importer.", true,
    schema({ url: str }, ["url"]),
    (ctx, input) => need(ctx, "studioApi", "Studio").importArticle(input.url)),
  op("studio_compose_local", "Compose an original song brief with the configured local model and save it on the project.", true,
    schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studioApi", "Studio").composeLocal(requireKey(input.id, "project id"))),
  op("studio_suno_refresh", "Refresh official Suno generation status for a project. The API key stays in the vault.", true,
    schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studioApi", "Studio").refreshSuno(requireKey(input.id, "project id"))),
  op("studio_suno_generate", "Submit a ready Studio project to the official Suno API.", true,
    schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studioApi", "Studio").generateSuno(requireKey(input.id, "project id"))),
  op("studio_suno_import", "Import a completed official Suno audio result into the project.", true,
    schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "studioApi", "Studio").importSunoAudio(requireKey(input.id, "project id"))),
  op("catalog_albums", "Page albums for one artist.", false, schema({ artistId: str, limit: int, cursor: str }, ["artistId"]),
    (ctx, input) => catalogOf(ctx).albums(requireKey(input.artistId, "artist id"), pageOptions(input))),
  op("catalog_songs", "Page catalog songs for one artist.", false, schema({ artistId: str, limit: int, cursor: str }, ["artistId"]),
    (ctx, input) => catalogOf(ctx).songs(requireKey(input.artistId, "artist id"), pageOptions(input))),
  op("catalog_album", "Read one album.", false, schema({ id: str }, ["id"]),
    (ctx, input) => catalogOf(ctx).album(requireKey(input.id, "album id"))),
  op("catalog_song", "Read one catalog song.", false, schema({ id: str }, ["id"]),
    (ctx, input) => catalogOf(ctx).song(requireKey(input.id, "song id"))),
  op("catalog_album_create", "Create an album for an artist.", true,
    schema({ artistId: str, title: str, kind: str, releaseDate: str }, ["artistId", "title"]),
    (ctx, input) => catalogOf(ctx).create(input)),
  op("catalog_album_update", "Update album title, kind or release date.", true,
    schema({ id: str, changes: obj, expectedRevision: int }, ["id", "changes"]),
    (ctx, input) => catalogOf(ctx).update(requireKey(input.id, "album id"), input.changes, input.expectedRevision)),
  op("catalog_album_add_tracks", "Add songs to an album.", true,
    schema({ id: str, songs: { type: "array" }, expectedRevision: int }, ["id", "songs"]),
    (ctx, input) => catalogOf(ctx).add(requireKey(input.id, "album id"), input.songs, input.expectedRevision)),
  op("catalog_album_reorder", "Reorder album entries.", true,
    schema({ id: str, entryIds: { type: "array", items: str }, expectedRevision: int }, ["id", "entryIds"]),
    (ctx, input) => catalogOf(ctx).reorder(requireKey(input.id, "album id"), input.entryIds, input.expectedRevision)),
  op("catalog_entry_remove", "Remove one album entry.", true,
    schema({ albumId: str, entryId: str, expectedRevision: int }, ["albumId", "entryId"]),
    (ctx, input) => catalogOf(ctx).remove(requireKey(input.albumId, "album id"), requireKey(input.entryId, "entry id"), input.expectedRevision)),
  op("catalog_entry_set_recording", "Choose the recording file already stored for an album entry.", true,
    schema({ albumId: str, entryId: str, audioAssetId: str, expectedRevision: int }, ["albumId", "entryId", "audioAssetId"]),
    (ctx, input) => catalogOf(ctx).recording(
      requireKey(input.albumId, "album id"), requireKey(input.entryId, "entry id"),
      requireKey(input.audioAssetId, "audio asset id"), input.expectedRevision)),
  op("music_dna_queue", "Queue analysis for one Music DNA profile.", true, schema({ profileId: str }, ["profileId"]),
    (ctx, input) => ctx.dna.queueAnalysis(requireKey(input.profileId, "profile id"))),
  op("music_dna_dismiss_failed", "Dismiss failed Music DNA jobs. Omit profileId to dismiss every failed job.", true,
    schema({ profileId: str }),
    (ctx, input) => ctx.dna.dismissFailedJobs(input.profileId ? requireKey(input.profileId, "profile id") : "")),
  op("music_dna_job_counts", "Count Music DNA analysis jobs by status.", false, schema({}),
    ctx => ctx.dna.jobCounts()),
  op("spotify_catalog_search", "Search the connected Spotify catalog. Returns metadata, not audio.", false, schema({ q: str }, ["q"]),
    (ctx, input) => need(ctx, "spotifyCatalog", "Spotify catalog").search(input.q || "")),
  op("spotify_import_track", "Import one Spotify catalog track as a Music DNA reference.", true, schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "spotifyCatalog", "Spotify catalog").importTrack(requireKey(input.id, "Spotify id"))),
  op("spotify_import_album", "Import one Spotify catalog album as Music DNA references.", true, schema({ id: str }, ["id"]),
    (ctx, input) => need(ctx, "spotifyCatalog", "Spotify catalog").importAlbum(requireKey(input.id, "Spotify id")))
];

function op(name, description, write, inputSchema, run) {
  return { name, description, write, inputSchema, run };
}

export function operationCatalog() {
  return {
    operations: OPERATIONS.map(({ run, ...item }) => item),
    withheld: WITHHELD
  };
}

export async function invokeOperation(ctx, args, { write = false } = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new DomainError("Expected a JSON object", 400);
  const operation = OPERATIONS.find(item => item.name === args.operation);
  if (!operation) throw new DomainError("Unknown operation", 404);
  if (operation.write && !write)
    throw new DomainError("blossom:write is required for " + operation.name, 403);
  const input = args.input === undefined ? {} : args.input;
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainError("Expected a JSON object", 400);
  rejectSecrets(input);
  return operation.run(ctx, input);
}
