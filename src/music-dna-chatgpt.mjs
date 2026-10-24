import { DomainError } from "./domain.mjs";

function strings(value, limit = 24) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean).slice(0, limit);
}
function field(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
export function youtubeResultsFromHtml(html) {
  const text = String(html || "");
  const marker = text.match(/ytInitialData\s*=\s*/);
  if (!marker) return [];
  const start = text.indexOf("{", marker.index);
  if (start < 0) return [];
  let depth = 0, end = -1, inString = false, escape = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return [];
  let data;
  try { data = JSON.parse(text.slice(start, end)); }
  catch { return []; }
  const found = [];
  const walk = node => {
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node) && node.videoRenderer && typeof node.videoRenderer === "object") {
      const video = node.videoRenderer;
      const title = video.title?.runs?.[0]?.text || "";
      const channel = video.ownerText?.runs?.[0]?.text || video.longBylineText?.runs?.[0]?.text || "";
      if (video.videoId && title) found.push({ videoId: String(video.videoId), title: String(title), channel: String(channel) });
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(data);
  return found;
}

function studioTitle(artist, title) {
  const escape = value => String(value || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escape(artist) + "\\s*[-–:]\\s*" + escape(title) + "\\b", "i");
}

function includesText(haystack, needle) {
  const wanted = String(needle || "").trim().toLocaleLowerCase();
  return wanted.length > 0 && String(haystack || "").toLocaleLowerCase().includes(wanted);
}

export function chooseYoutubeRecording(results, artist, title) {
  let best = null, bestScore = 0;
  for (const item of results || []) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(item?.videoId || "")) continue;
    const label = String(item.title || "").toLocaleLowerCase();
    const noisy = /\b(live|lyrics|lyric|karaoke|cover|reaction|remix|audio)\b/.test(label);
    let score = 0;
    const studio = studioTitle(artist, title).test(String(item.title || ""));
    if (includesText(item.title, artist) && includesText(item.title, title)) score += 4;
    else if (includesText(item.title, title)) score += 2;
    if (!noisy && label.includes("official video")) score += 3;
    if (studio && !noisy && label.includes("official video")) score += 5;
    if (includesText(item.channel, artist)) score += 2;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  return bestScore >= 4 ? best : null;
}

export function analysisFromYoutube(profile, hit) {
  const artist = field(profile?.artist, 180);
  const title = field(profile?.title, 180);
  const videoId = String(hit?.videoId || "");
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId))
    throw new DomainError("YouTube search found no recording", 502);
  const videoTitle = field(hit.title, 180);
  const channel = field(hit.channel, 120);
  const watch = "https://www.youtube.com/watch?v=" + videoId;
  return {
    genres: [], moods: [], instruments: [], vocals: {}, production: {},
    summary: artist + " — " + title + ". YouTube search found \"" + videoTitle + "\"" +
      (channel ? " from " + channel : "") + " (" + watch + "). " +
      "This is a source lookup, not a measured analysis of the audio.",
    analysisMethod: "youtube-search", analyzer: "youtube", confidence: 0.3, measurements: null
  };
}

export async function searchYoutube(profile, fetchImpl = globalThis.fetch) {
  const artist = field(profile?.artist, 180);
  const title = field(profile?.title, 180);
  const query = (artist + " " + title).trim();
  if (!query || typeof fetchImpl !== "function") return null;
  const response = await fetchImpl(
    "https://www.youtube.com/results?search_query=" + encodeURIComponent(query),
    { headers: { "user-agent": "Mozilla/5.0", "accept-language": "en" } }
  );
  if (!response?.ok) return null;
  return chooseYoutubeRecording(youtubeResultsFromHtml(await response.text()), artist, title);
}

export function dnaPrompt(profile) {
  const artist = field(profile?.artist, 180);
  const title = field(profile?.title, 180);
  return [
    "Describe this known recording for a private music library.",
    "Return one JSON object and no other text.",
    "Recording: " + artist + " — " + title,
    "Fields: genres (strings), moods (strings), instruments (objects with name, technique, role),",
    "vocals (type, delivery), production (era, texture), summary (one paragraph), bpm (number or null), musicalKey (string).",
    "Use only what you know about this recording. Do not invent timestamps, lyrics, or a claim that you heard the audio."
  ].join("\n");
}
export function analysisFromReply(reply) {
  const text = String(reply || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new DomainError("ChatGPT reply was not a music analysis", 502);
  let parsed;
  try { parsed = JSON.parse(body.slice(start, end + 1)); }
  catch { throw new DomainError("ChatGPT reply was not a music analysis", 502); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new DomainError("ChatGPT reply was not a music analysis", 502);
  const genres = strings(parsed.genres);
  const summary = field(parsed.summary, 3000);
  if (!genres.length && !summary) throw new DomainError("ChatGPT reply was not a music analysis", 502);
  const bpm = Number(parsed.bpm);
  const instruments = Array.isArray(parsed.instruments) ? parsed.instruments : [];
  return {
    genres, moods: strings(parsed.moods),
    instruments: instruments.slice(0, 12).map(item => ({
      name: field(item?.name, 100),
      technique: field(item?.technique, 200),
      role: field(item?.role, 140)
    })).filter(item => item.name),
    vocals: { type: field(parsed.vocals?.type, 80), delivery: field(parsed.vocals?.delivery, 250) },
    production: { era: field(parsed.production?.era, 100), texture: field(parsed.production?.texture, 400) },
    summary, musicalKey: field(parsed.musicalKey, 32),
    ...(Number.isInteger(bpm) && bpm >= 20 && bpm <= 350 ? { bpm } : {}),
    analysisMethod: "chatgpt-catalog", analyzer: "chatgpt", confidence: 0.4, measurements: null
  };
}

export class MusicDnaChatGpt {
  constructor(dna, ask, search = searchYoutube) {
    this.dna = dna;
    this.ask = ask;
    this.search = search;
    this.running = false;
    this.done = Promise.resolve();
    this.prefer = "";
  }
  start(profileId = "") {
    if (typeof this.ask !== "function") throw new DomainError("ChatGPT analysis is unavailable", 503);
    const preferred = typeof profileId === "string" ? profileId.trim() : "";
    if (preferred) this.prefer = preferred;
    if (this.running) {
      if (preferred) this.dna.queueProfile(preferred);
      return { started: false };
    }
    this.dna.requeueCatalogAnalysis("chatgpt");
    if (preferred) this.dna.queueProfile(preferred);
    this.running = true;
    this.done = this.drain().finally(() => { this.running = false; });
    return { started: true };
  }
  async drain() {
    for (;;) {
      const outcome = await this.processOne();
      if (!outcome || outcome.stop) return;
    }
  }
  async processOne() {
    const preferred = this.prefer;
    this.prefer = "";
    const job = this.dna.claimJob("chatgpt", { metadataOnly: true, profileId: preferred });
    if (!job) return null;
    const report = percent => this.dna.setJobProgress(job.jobId, percent);
    try {
      report(5);
      const reply = await this.ask(dnaPrompt(job.profile), report);
      report(90);
      const analysis = analysisFromReply(reply);
      report(100);
      return this.dna.completeJob(job.jobId, analysis);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ChatGPT analysis failed";
      if (error?.code === "chatgpt_busy") {
        this.dna.releaseJob(job.jobId);
        return { status: "queued", stop: true };
      }
      if (error?.code !== "chatgpt_login_required") {
        const fromYoutube = await this.youtubeAnalysis(job.profile);
        if (fromYoutube) {
          report(100);
          return this.dna.completeJob(job.jobId, fromYoutube);
        }
      }
      this.dna.completeJob(job.jobId, null, message.slice(0, 800));
      return { status: "failed", stop: error?.code === "chatgpt_login_required" };
    }
  }

  async youtubeAnalysis(profile) {
    try {
      const hit = await this.search(profile);
      return hit ? analysisFromYoutube(profile, hit) : null;
    } catch {
      return null;
    }
  }
}
