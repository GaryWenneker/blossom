import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { DomainError } from "./domain.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 50;
const TERMINAL = new Set(["published", "already_published", "held_low_confidence",
  "held_no_reliable_bpm", "held_missing_edition", "held_missing_duration",
  "held_decode_duration_mismatch", "failed", "awaiting_download_authorization"]);

export class MusicDnaAutopilot {
  constructor(dna, { analyzerDir = process.env.BLOSSOM_ANALYZER_DIR || resolve("analyzer"),
    runner = resolve("scripts/music-dna-autopilot-profile.py"), processSpawn = spawn } = {}) {
    this.dna = dna;
    this.analyzerDir = resolve(analyzerDir);
    this.runner = resolve(runner);
    this.processSpawn = processSpawn;
    this.queue = [];
    this.jobs = new Map();
    this.running = false;
  }
  status() {
    return { jobs: [...this.jobs.values()].map(({ id, artist, title, status, message, updatedAt }) =>
      ({ id, artist, title, status, message, updatedAt })),
    running: this.running, queued: this.queue.length };
  }
  enqueue(ids, rightsConfirmed) {
    if (rightsConfirmed !== true)
      throw new DomainError("Confirm you have permission to download and analyze the selected recordings", 403);
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BATCH ||
      ids.some(id => typeof id !== "string" || !UUID.test(id)))
      throw new DomainError("Select 1–50 valid Music DNA recording IDs", 400);
    const unique = [...new Set(ids)];
    const profiles = unique.map(id => this.dna.get(id)); // Validate all IDs before scheduling any work.
    let queued = 0, skipped = 0;
    for (const profile of profiles) {
      const previous = this.jobs.get(profile.id);
      if (previous && (previous.status === "queued" || previous.status === "running")) {
        skipped++; continue;
      }
      this.jobs.set(profile.id, {
        id: profile.id, artist: profile.artist, title: profile.title,
        status: "queued", message: "Waiting for the local audio bridge",
        updatedAt: new Date().toISOString()
      });
      this.queue.push({ id: profile.id, artist: profile.artist, title: profile.title,
        year: profile.releaseYear || null, durationMs: profile.analysis?.durationMs || null });
      queued++;
    }
    if (queued) void this.drain();
    return { ...this.status(), queued, skipped };
  }
  update(id, status, message) {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, { status, message: String(message || "").slice(0, 320),
      updatedAt: new Date().toISOString() });
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) await this.runOne(this.queue.shift());
    } finally { this.running = false; }
  }
  async runOne(profile) {
    if (!existsSync(this.runner) || !existsSync(join(this.analyzerDir, "blossom_bridge.py")) ||
      !existsSync(join(this.analyzerDir, ".venv/bin/python"))) {
      this.update(profile.id, "failed",
        "Analyzer unavailable. Install the Blossom Autopilot in the analyzer folder and run install.command.");
      return;
    }
    this.update(profile.id, "running", "Searching YouTube and validating the edition");
    const environment = { ...process.env,
      BLOSSOM_MCP_URL: "http://127.0.0.1:8787/mcp",
      PYTHONPATH: this.analyzerDir };
    // Never forward an explicit externally scoped token to the child.
    delete environment.BLOSSOM_MCP_TOKEN;
    return new Promise(resolveDone => {
      let output = "", errors = "", finished = false;
      const finish = (status, message) => {
        if (finished) return;
        finished = true;
        this.update(profile.id, status, message);
        resolveDone();
      };
      let child;
      try {
        child = this.processSpawn(join(this.analyzerDir, ".venv/bin/python"),
          [this.runner], { cwd: this.analyzerDir, env: environment,
            stdio: ["pipe", "pipe", "pipe"] });
      } catch (error) { finish("failed", error.message); return; }
      child.stdout?.on("data", part => {
        output = (output + String(part)).slice(-20000);
        if (output.includes("Audio meten")) this.update(profile.id, "running", "Measuring audio");
      });
      child.stderr?.on("data", part => { errors = (errors + String(part)).slice(-1600); });
      child.on("error", error => finish("failed", error.message));
      child.on("close", code => {
        if (finished) return;
        const match = output.match(/AUTOPILOT_RESULT=(\{[^\r\n]+\})/);
        if (!match) return finish("failed",
          code === 0 ? "Analyzer returned no verifiable result" : errors || "Analyzer exited with code " + code);
        try {
          const result = JSON.parse(match[1]);
          const state = String(result.status || "");
          finish(TERMINAL.has(state) ? state : "failed",
            result.message || (state === "published" ? "Audio DNA published via MCP" : state));
        } catch { finish("failed", "Malformed analyzer response"); }
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(JSON.stringify(profile));
    });
  }
}
