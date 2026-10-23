import { join } from "node:path";
import { MusicDNA } from "./music-dna.mjs";
import { measureAudio, measuredDNA } from "./music-audio.mjs";

const SAFE_FILENAME = /^[0-9a-f-]{36}\.(?:mp3|wav)$/;
export class MusicDnaWorker {
  constructor(store, { audioDir = process.env.BLOSSOM_REFERENCE_AUDIO_DIR || ".data/reference-audio",
    analyzer = measureAudio, name = "blossom-audio-worker" } = {}) {
    this.dna = new MusicDNA(store);
    this.audioDir = audioDir;
    this.analyzer = analyzer;
    this.name = name;
  }
  async processOne() {
    // Metadata-only jobs remain queued for an analyst, not mistakenly marked "analyzed".
    const job = this.dna.claimJob(this.name, { audioOnly: true });
    if (!job) return null;
    try {
      const asset = this.dna.audioForProfile(job.profile.id);
      if (!asset || !asset.rightsConfirmed || !SAFE_FILENAME.test(asset.filename))
        throw new Error("Missing or unauthorized reference audio");
      const metrics = await this.analyzer(join(this.audioDir, asset.filename));
      const result = this.dna.completeJob(job.jobId, measuredDNA(metrics));
      return { jobId: job.jobId, profileId: job.profile.id, status: result.status,
        measurements: metrics };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown audio analysis failure";
      this.dna.completeJob(job.jobId, null, message.slice(0, 800));
      return { jobId: job.jobId, profileId: job.profile.id, status: "failed", error: message };
    }
  }
  async drain({ maxJobs = 1000 } = {}) {
    let processed = 0, failed = 0;
    while (processed < maxJobs) {
      const result = await this.processOne();
      if (!result) break;
      processed++;
      if (result.status === "failed") failed++;
    }
    return { processed, failed };
  }
}
