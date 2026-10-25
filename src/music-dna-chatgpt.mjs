import { DomainError } from "./domain.mjs";

function strings(value, limit = 24) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || "").trim()).filter(Boolean).slice(0, limit);
}
function field(value, limit) {
  return String(value || "").trim().slice(0, limit);
}
function catalogBpm(value) {
  const bpm = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 350)
    throw new DomainError("ChatGPT reply omitted a BPM", 502);
  return bpm;
}
export function dnaPrompt(profile) {
  const artist = field(profile?.artist, 180);
  const title = field(profile?.title, 180);
  return [
    "Describe this known recording for a private music library.",
    "Return one JSON object and no other text.",
    "Recording: " + artist + " — " + title,
    "Fields: genres (strings), moods (strings), instruments (objects with name, technique, role),",
    "vocals (type, delivery), production (era, texture), summary (one paragraph), bpm (required number from 20 to 350, never null), musicalKey (string).",
    "Use only what you know about this recording. Do not invent timestamps, lyrics, or a claim that you heard the audio."
  ].join("\n");
}
export function chatGptConversationUrl(value) {
  const url = String(value || "").trim().split(/[?#]/)[0];
  return /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9_-]{8,80}$/.test(url) ? url : "";
}

export function analysisFromReply(reply) {
  let text = String(reply || "").trim();
  let chatUrl = "";
  const breakAt = text.indexOf("\n");
  if (breakAt > 0) {
    chatUrl = chatGptConversationUrl(text.slice(0, breakAt));
    if (chatUrl) text = text.slice(breakAt + 1).trim();
  }
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
  const bpm = catalogBpm(parsed.bpm);
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
    summary, musicalKey: field(parsed.musicalKey, 32), bpm,
    analysisMethod: "chatgpt-catalog", analyzer: "chatgpt", confidence: 0.4, measurements: null,
    ...(chatUrl ? { chatSession: { provider: "chatgpt", url: chatUrl } } : {})
  };
}

export class MusicDnaChatGpt {
  constructor(dna, ask) {
    this.dna = dna;
    this.ask = ask;
    this.running = false;
    this.onlyProfileId = "";
    this.done = Promise.resolve();
  }
  start(profileId = "") {
    if (this.running) return { started: false };
    if (typeof this.ask !== "function") throw new DomainError("ChatGPT analysis is unavailable", 503);
    const only = profileId ? String(profileId) : "";
    if (only && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(only))
      throw new DomainError("Invalid ID");
    this.onlyProfileId = only;
    if (!only) this.dna.requeueCatalogAnalysis("chatgpt");
    this.running = true;
    this.done = this.drain().finally(() => { this.running = false; this.onlyProfileId = ""; });
    return { started: true };
  }
  async drain() {
    for (;;) {
      const outcome = await this.processOne();
      if (!outcome || outcome.stop) return;
    }
  }
  async processOne() {
    const only = this.onlyProfileId;
    const job = this.dna.claimJob("chatgpt", { metadataOnly: !only, profileId: only });
    if (!job) return null;
    const report = percent => this.dna.setJobProgress(job.jobId, percent);
    try {
      report(5);
      const reply = await this.ask(dnaPrompt(job.profile), report);
      report(90);
      const analysis = analysisFromReply(reply);
      if (!analysis.chatSession?.url)
        throw new DomainError("ChatGPT did not open a conversation for this analysis", 502);
      report(100);
      const saved = this.dna.completeJob(job.jobId, analysis);
      return only ? { ...saved, stop: true } : saved;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ChatGPT analysis failed";
      if (error?.code === "chatgpt_busy") {
        this.dna.releaseJob(job.jobId);
        return { status: "queued", stop: true };
      }
      this.dna.completeJob(job.jobId, null, message.slice(0, 800));
      return { status: "failed", stop: error?.code === "chatgpt_login_required" || Boolean(only) };
    }
  }
}
