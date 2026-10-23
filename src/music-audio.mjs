import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { DomainError } from "./domain.mjs";

export const MAX_REFERENCE_AUDIO_BYTES = 40 * 1024 * 1024;
const ANALYSIS_RATE = 8000;
const MAX_DURATION_SECONDS = 900;

export function validateAudio(bytes, mime) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 128 || bytes.length > MAX_REFERENCE_AUDIO_BYTES)
    throw new DomainError("Reference audio must be between 128 bytes and 40 MB", 413);
  if (!["audio/mpeg", "audio/wav", "audio/x-wav"].includes(mime))
    throw new DomainError("Only MP3 and WAV are supported", 415);
  const wav = bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE";
  const mp3 = bytes.subarray(0, 3).toString("ascii") === "ID3" ||
    (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0);
  if (mime === "audio/mpeg" ? !mp3 : !wav)
    throw new DomainError("Audio contents do not match the declared MIME type", 400);
  return { mime: mp3 ? "audio/mpeg" : "audio/wav", extension: mp3 ? "mp3" : "wav",
    sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length };
}

export class PCMAccumulator {
  constructor(sampleRate = ANALYSIS_RATE) {
    this.sampleRate = sampleRate;
    this.samples = 0;
    this.sumSquares = 0;
    this.peak = 0;
    this.silent = 0;
    this.remainder = null;
  }
  push(buffer) {
    if (!Buffer.isBuffer(buffer)) throw new DomainError("PCM input must be a Buffer");
    let data = buffer;
    if (this.remainder !== null) {
      data = Buffer.concat([Buffer.from([this.remainder]), data]);
      this.remainder = null;
    }
    if (data.length % 2) {
      this.remainder = data[data.length - 1];
      data = data.subarray(0, -1);
    }
    for (let i = 0; i < data.length; i += 2) {
      const sample = data.readInt16LE(i) / 32768;
      this.samples++;
      this.sumSquares += sample * sample;
      this.peak = Math.max(this.peak, Math.abs(sample));
      if (Math.abs(sample) < 0.01) this.silent++;
    }
    if (this.samples > this.sampleRate * MAX_DURATION_SECONDS)
      throw new DomainError("Audio exceeds the 15-minute analysis limit", 413);
  }
  finish() {
    if (this.remainder !== null || this.samples === 0)
      throw new DomainError("Audio decoder returned incomplete or empty PCM", 422);
    const rms = Math.sqrt(this.sumSquares / this.samples);
    const dB = amplitude => amplitude ? Math.round(20 * Math.log10(amplitude) * 100) / 100 : null;
    return { peakDbfs: dB(this.peak), rmsDbfs: dB(rms),
      silenceFraction: Math.round((this.silent / this.samples) * 10000) / 10000,
      analysisSampleRate: this.sampleRate, decodedSamples: this.samples };
  }
}

// A bounded subprocess runner. The input filename is a server-generated path, never user input.
// Abort both ffprobe and ffmpeg if the executable stalls or returns unreasonable output.
function run(command, args, { runner = spawn, timeoutMs = 120_000, maxBytes = 100_000,
  onData = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = runner(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { reject(new DomainError("Audio tools could not start: " + error.message, 503)); return; }
    let finished = false, total = 0, output = "", diagnostics = "";
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) { try { child.kill("SIGKILL"); } catch {} reject(error); }
      else resolve(output);
    };
    const timer = setTimeout(() => finish(new DomainError("Audio analysis timed out", 504)), timeoutMs);
    child.stdout.on("data", chunk => {
      if (finished) return;
      total += chunk.length;
      if (total > maxBytes) return finish(new DomainError("Audio decoding exceeded the configured limit", 413));
      try { onData(chunk); }
      catch (error) { finish(error); return; }
      if (command.endsWith("ffprobe")) output += chunk.toString("utf8");
    });
    child.stderr.on("data", chunk => {
      diagnostics = (diagnostics + chunk.toString("utf8")).slice(-1000);
    });
    child.once("error", error => finish(new DomainError("Audio tool unavailable: " + error.message, 503)));
    child.once("close", code => {
      if (finished) return;
      if (code !== 0) finish(new DomainError("Audio decoding failed: " + diagnostics.slice(0, 240), 422));
      else finish();
    });
  });
}

export async function measureAudio(filename, { runner = spawn, ffprobe = "ffprobe", ffmpeg = "ffmpeg" } = {}) {
  const probeText = await run(ffprobe,
    ["-v", "error", "-select_streams", "a:0", "-show_entries",
      "stream=codec_name,sample_rate,channels:format=duration", "-of", "json", filename],
    { runner, maxBytes: 100_000, timeoutMs: 20_000 });
  let probe;
  try { probe = JSON.parse(probeText); }
  catch { throw new DomainError("ffprobe returned invalid metadata", 422); }
  const stream = probe.streams?.[0];
  const seconds = Number(probe.format?.duration);
  const channels = Number(stream?.channels);
  const sampleRate = Number(stream?.sample_rate);
  if (!stream || !Number.isFinite(seconds) || seconds < 1 || seconds > MAX_DURATION_SECONDS)
    throw new DomainError("Audio must have a decodable stream between 1 and 900 seconds", 422);
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 ||
      !Number.isInteger(channels) || channels < 1 || channels > 16)
    throw new DomainError("Unsupported audio channel/sample rate metadata", 422);
  const pcm = new PCMAccumulator(ANALYSIS_RATE);
  await run(ffmpeg,
    ["-v", "error", "-nostdin", "-i", filename, "-map", "0:a:0", "-vn",
      "-ac", "1", "-ar", String(ANALYSIS_RATE), "-acodec", "pcm_s16le", "-f", "s16le", "pipe:1"],
    { runner, maxBytes: ANALYSIS_RATE * MAX_DURATION_SECONDS * 2 + 16, onData: chunk => pcm.push(chunk) });
  return { durationMs: Math.round(seconds * 1000), sampleRate, channels,
    codec: String(stream.codec_name || "unknown").slice(0, 80), ...pcm.finish() };
}
export function measuredDNA(metrics) {
  if (!metrics || typeof metrics !== "object") throw new DomainError("Missing measurements");
  const volume = (value) => value === null ? "unmeasurable" : value + " dBFS";
  return {
    analysisMethod: "decoded PCM signal measurements (no instrument or vocal classification)",
    analyzer: "Blossom FFmpeg DSP v1",
    durationMs: metrics.durationMs, genres: [], moods: [], instruments: [],
    vocals: {}, sections: [],
    production: { dynamics: "Signal RMS " + volume(metrics.rmsDbfs) + "; sample peak " + volume(metrics.peakDbfs) },
    measurements: { sampleRate: metrics.sampleRate, channels: metrics.channels,
      codec: metrics.codec, analysisSampleRate: metrics.analysisSampleRate,
      decodedSamples: metrics.decodedSamples, peakDbfs: metrics.peakDbfs,
      rmsDbfs: metrics.rmsDbfs, silenceFraction: metrics.silenceFraction },
    summary: "Automatic signal-level inspection only. Tempo, key, instruments, playing technique, vocals and song structure require further verified analysis."
  };
}
