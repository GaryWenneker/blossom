import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, appendFile, chmod, mkdir, lstat, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Store } from "../src/storage.mjs";
import { MusicDNA } from "../src/music-dna.mjs";
import { MusicDnaWorker } from "../src/music-dna-worker.mjs";
import { PREFERRED_DRAW_MODEL } from "../src/draw-models.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const minimumNode = { major: 22, minor: 13 };
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  return Number.isInteger(major) && Number.isInteger(minor) &&
    (major > 22 || (major === 22 && minor >= 13));
}
export function parseEnv(content) {
  const config = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z_0-9]*)=(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    config[match[1]] = value;
  }
  return config;
}
export function missingSettings(config, rng = randomBytes) {
  const defaults = {
    BLOSSOM_ADMIN_USERNAME: "admin",
    BLOSSOM_ADMIN_PASSWORD: rng(24).toString("base64url"),
    BLOSSOM_VAULT_KEY: rng(32).toString("base64"),
    BLOSSOM_MCP_READ_TOKEN: rng(32).toString("hex"),
    BLOSSOM_MCP_WRITE_TOKEN: rng(32).toString("hex"),
    BLOSSOM_HOST: "127.0.0.1",
    BLOSSOM_PORT: "8787",
    BLOSSOM_PUBLIC_URL: "http://127.0.0.1:8787",
    BLOSSOM_DB: ".data/blossom.db",
    BLOSSOM_REFERENCE_AUDIO_DIR: ".data/reference-audio",
    BLOSSOM_DRAW_MODEL: PREFERRED_DRAW_MODEL
  };
  return Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in config)));
}
export function validateSettings(settings) {
  if (typeof settings.BLOSSOM_ADMIN_PASSWORD !== "string" ||
      settings.BLOSSOM_ADMIN_PASSWORD.length < 12)
    throw Error("BLOSSOM_ADMIN_PASSWORD must be 12+ characters");
  if (!/^[a-zA-Z][a-zA-Z0-9._-]{2,60}$/.test(settings.BLOSSOM_ADMIN_USERNAME || ""))
    throw Error("Invalid admin username");
  const key = settings.BLOSSOM_VAULT_KEY || "";
  if (!/^(?:[A-Za-z0-9+/]{4}){10}(?:[A-Za-z0-9+/]{3}=)$/.test(key) ||
      Buffer.from(key, "base64").length !== 32)
    throw Error("BLOSSOM_VAULT_KEY must be a base64-encoded 32-byte key");
  for (const name of ["BLOSSOM_MCP_READ_TOKEN", "BLOSSOM_MCP_WRITE_TOKEN"]) {
    if (typeof settings[name] !== "string" || settings[name].length < 32)
      throw Error(name + " must contain at least 32 characters");
  }
  if ((settings.BLOSSOM_MCP_READ_TOKEN || "") === settings.BLOSSOM_MCP_WRITE_TOKEN)
    throw Error("Read and write MCP tokens must not be equal");
  if (settings.BLOSSOM_HOST !== "127.0.0.1" ||
      settings.BLOSSOM_PUBLIC_URL !== "http://127.0.0.1:8787" ||
      settings.BLOSSOM_PORT !== "8787")
    throw Error("Setup only supports loopback port 8787. Custom deployments require manual review.");
  for (const key of ["BLOSSOM_DB", "BLOSSOM_REFERENCE_AUDIO_DIR"]) {
    const value = settings[key] || "";
    if (!value || value.includes("\0")) throw Error("Invalid " + key);
  }
  return true;
}
export async function configureEnv(envFile, { create = true } = {}) {
  let existing = "";
  try {
    const stat = await lstat(envFile);
    if (stat.isSymbolicLink() || !stat.isFile()) throw Error("Refusing unsafe .env path");
    existing = await readFile(envFile, "utf8");
    if (create) await chmod(envFile, 0o600);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    if (!create) throw Error(".env does not exist. Run bash setup.sh to configure.");
  }
  const parsed = parseEnv(existing);
  const additions = create ? missingSettings(parsed) : {};
  const repairBlankModel = create && Object.hasOwn(parsed, "BLOSSOM_DRAW_MODEL") && !parsed.BLOSSOM_DRAW_MODEL.trim();
  if (create) {
    if (repairBlankModel) {
      const repaired = existing.replace(/^(\s*(?:export\s+)?BLOSSOM_DRAW_MODEL=)[^\r\n]*/m,
        "$1" + PREFERRED_DRAW_MODEL);
      if (repaired === existing) throw Error("Could not repair blank BLOSSOM_DRAW_MODEL");
      existing = repaired;
      parsed.BLOSSOM_DRAW_MODEL = PREFERRED_DRAW_MODEL;
      await writeFile(envFile, existing, { mode: 0o600 });
    }
    if (Object.keys(additions).length) {
      const block = (existing && !existing.endsWith("\n") ? "\n" : "") +
        Object.entries(additions).map(([key, value]) => key + "=" + value + "\n").join("");
      if (existing) await appendFile(envFile, block, { mode: 0o600 });
      else await writeFile(envFile, block, { flag: "wx", mode: 0o600 });
    }
    await chmod(envFile, 0o600);
  }
  const merged = { ...parsed, ...additions };
  validateSettings(merged);
  return { settings: merged, generatedPassword: !!additions.BLOSSOM_ADMIN_PASSWORD, generatedKeys: Object.keys(additions) };
}
async function exec(command, args, { cwd = ROOT, timeout = 180_000, allowFailure = false } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(command, args, { cwd, shell: false, env: process.env,
      stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", finished = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); settle(Error(command + " timed out")); }, timeout);
    const settle = err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (err) rej(err);
      else res({ output, error });
    };
    child.stdout.on("data", chunk => { output = (output + chunk.toString("utf8")).slice(-12000); });
    child.stderr.on("data", chunk => { error = (error + chunk.toString("utf8")).slice(-12000); });
    child.on("error", err => settle(Error(command + " unavailable: " + err.message)));
    child.on("close", code => {
      if (code !== 0 && !allowFailure)
        settle(Error(command + " " + args.join(" ") + " exited " + code + ": " + (error || output).slice(-1200)));
      else settle();
    });
  });
}
export function makeTestWave(seconds = 1) {
  const count = 8000 * seconds, payload = count * 2, b = Buffer.alloc(payload + 44);
  b.write("RIFF", 0); b.writeUInt32LE(payload + 36, 4);
  b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(payload, 40);
  for (let i = 0; i < count; i++)
    b.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / 8000)), 44 + i * 2);
  return b;
}
export async function smokeAudio() {
  const dir = await mkdtemp(join(tmpdir(), "blossom-setup-audio-"));
  const store = new Store(":memory:");
  try {
    const name = randomUUID() + ".wav";
    await writeFile(join(dir, name), makeTestWave(), { mode: 0o600 });
    const dna = new MusicDNA(store), ref = dna.create({
      artist: "Blossom Setup", title: "Synthetic self-test", sourceKind: "local-audio"
    });
    dna.attachAudio(ref.id, { filename: name, sha256: randomBytes(32).toString("hex"),
      byteSize: 16044, mime: "audio/wav", rightsConfirmed: true });
    const result = await new MusicDnaWorker(store, { audioDir: dir }).processOne();
    if (result?.status !== "completed") throw Error("Worker failed: " + (result?.error || "no job"));
    const a = dna.get(ref.id).analysis;
    if (a.durationMs !== 1000 || a.measurements?.decodedSamples !== 8000 ||
        typeof a.measurements.peakDbfs !== "number" || a.instruments.length)
      throw Error("Synthetic audio analysis produced invalid metrics");
    return { durationMs: a.durationMs, peakDbfs: a.measurements.peakDbfs };
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
export function xmlEscape(value) {
  return String(value).replace(/[<>&"']/g, c =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}
export function launchPlist({ label, nodePath, root = ROOT, envPath, logPath, worker = false, searchPath = process.env.PATH }) {
  const args = [nodePath, "--env-file=" + envPath,
    worker ? "scripts/music-dna-worker.mjs" : "src/server.mjs",
    ...(worker ? ["--loop"] : [])];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    "<key>Label</key><string>" + xmlEscape(label) + "</string>",
    "<key>ProgramArguments</key><array>" + args.map(a => "<string>" + xmlEscape(a) + "</string>").join("") + "</array>",
    "<key>WorkingDirectory</key><string>" + xmlEscape(root) + "</string>",
    "<key>EnvironmentVariables</key><dict><key>PATH</key><string>" + xmlEscape(searchPath || "/usr/bin:/bin") + "</string></dict>",
    "<key>StandardOutPath</key><string>" + xmlEscape(logPath) + "</string>",
    "<key>StandardErrorPath</key><string>" + xmlEscape(logPath) + "</string>",
    "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>",
    "</dict></plist>"
  ].join("\n");
}
async function checkHealth() {
  try {
    const r = await fetch("http://127.0.0.1:8787/healthz", { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).status === "ok";
  } catch { return false; }
}
async function configureLaunchd(envFile) {
  const uid = process.getuid(), gui = "gui/" + uid;
  const dir = join(process.env.HOME, "Library", "LaunchAgents"), logs = join(ROOT, ".data", "logs");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await mkdir(logs, { recursive: true, mode: 0o700 });
  const managed = [
    ["io.wenneker.blossom.server", false],
    ["io.wenneker.blossom.dna-worker", true]
  ];
  const outcome = [];
  for (const [label, worker] of managed) {
    const target = join(dir, label + ".plist");
    const expected = launchPlist({ label, nodePath: process.execPath, envPath: envFile,
      worker, logPath: join(logs, worker ? "worker.log" : "server.log") });
    let existing = null;
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) throw Error("Unsafe launch agent " + target);
      existing = await readFile(target, "utf8");
      if (!existing.includes("<string>" + label + "</string>") ||
          !existing.includes(xmlEscape(ROOT)))
        throw Error("Refusing to overwrite an unrelated launch agent: " + target);
    } catch (err) { if (err.code !== "ENOENT") throw err; }
    const isLoaded = async () => {
      try { await exec("launchctl", ["print", gui + "/" + label], { timeout: 5000 }); return true; }
      catch { return false; }
    };
    if (!worker && !existing && await checkHealth()) {
      outcome.push({ label, state: "existing local server detected; not replaced" });
      continue;
    }
    // Restart managed agents even when the plist is unchanged: code and .env may have changed.
    if (await isLoaded()) await exec("launchctl", ["bootout", gui + "/" + label], { timeout: 10000 });
    if (existing !== expected) {
      const temp = target + "." + randomUUID() + ".tmp";
      await writeFile(temp, expected, { flag: "wx", mode: 0o600 });
      await import("node:fs/promises").then(fs => fs.rename(temp, target));
    }
    if (!await isLoaded()) await exec("launchctl", ["bootstrap", gui, target], { timeout: 15000 });
    outcome.push({ label, state: "loaded" });
  }
  return outcome;
}
export async function runSetup({ check = false, noServices = false, emit = () => {},
  root = ROOT, envFile = join(ROOT, ".env") } = {}) {
  let stages = 0, optionalWarnings = 0;
  const step = async (name, fn, { optional = false } = {}) => {
    emit("STEP|" + name + "|RUN|");
    try {
      const info = await fn();
      stages++;
      emit("STEP|" + name + "|OK|" + String(info || "ready").replace(/[\r\n|]/g, " ").slice(0, 300));
      return info;
    } catch (error) {
      const reason = String(error.message).replace(/[\r\n|]/g, " ").slice(0, 1200);
      if (optional) {
        optionalWarnings++;
        stages++;
        emit("STEP|" + name + "|WARN|" + reason);
        return null;
      }
      emit("STEP|" + name + "|FAIL|" + reason);
      throw error;
    }
  };
  await step("Runtime", async () => {
    if (!nodeSupported()) throw Error("Node.js 22.13 or later is required");
    for (const [name, args] of [
      ["ffmpeg", ["-version"]], ["ffprobe", ["-version"]], ["npm", ["--version"]]
    ]) await exec(name, args);
    return "Node " + process.version + ", FFmpeg and npm found";
  });
  const config = await step("Secure settings", async () => {
    const data = await configureEnv(envFile, { create: !check });
    if (data.generatedPassword)
      emit("NOTICE|First-run administrator password is stored privately in .env (BLOSSOM_ADMIN_PASSWORD)");
    return data;
  });
  await step("Private storage", async () => {
    if (check) {
      const stat = await lstat(join(root, ".data"));
      if (!stat.isDirectory()) throw Error("Local .data folder is missing");
      return "storage directory exists";
    }
    await mkdir(join(root, ".data", "reference-audio"), { recursive: true, mode: 0o700 });
    await mkdir(join(root, ".data", "logs"), { recursive: true, mode: 0o700 });
    return "local storage prepared (existing database preserved)";
  });
  await step("Playwright setup", async () => {
    if (!check) await exec("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, timeout: 240_000 });
    try { await import("playwright-core"); }
    catch { throw Error("Playwright Core not installed; run npm install"); }
    return "Supervised Playwright Core package ready (Google Chrome required for use)";
  });
  await step("Draw Things diagnostics", async () => {
    const { access } = await import("node:fs/promises");
    const appPaths = [
      "/Applications/Draw Things.app",
      join(process.env.HOME || "", "Applications", "Draw Things.app")
    ];
    const installedApp = (await Promise.all(appPaths.map(async path => {
      try { await access(path); return true; } catch { return false; }
    }))).some(Boolean);
    const cli = process.env.BLOSSOM_DRAW_COMMAND || "draw-things-cli";
    const { delimiter } = await import("node:path");
    const paths = (process.env.PATH || "").split(delimiter);
    const foundCli = await Promise.all(paths.map(async dir => {
      try { await access(join(dir, cli), (await import("node:fs")).constants.X_OK); return true; }
      catch { return false; }
    }));
    if (!foundCli.some(Boolean)) {
      emit("NOTICE|Draw Things CLI not found in PATH. Image generation needs a working CLI. Install/configure the Draw Things command, then rerun setup. The app alone is not proof the CLI is available.");
      throw Error(installedApp ? "Draw Things app found but CLI unavailable" : "Draw Things CLI unavailable");
    }
    return "Draw Things CLI executable found; image model availability still requires a generation smoke test";
  }, { optional: true });
  await step("Syntax validation", async () => { await exec("npm", ["run", "check"], { cwd: root }); return "syntax checks passed"; });
  await step("Automated tests", async () => { await exec("npm", ["test"], { cwd: root }); return "test suite passed"; });
  await step("Audio self-test", async () => {
    const result = await smokeAudio();
    return "FFmpeg decoded " + result.durationMs + "ms synthetic WAV; peak " + result.peakDbfs + " dBFS";
  });
  await step("Local services", async () => {
    if (check || noServices) return check ? "read-only check; no launchd changes" : "skipped with --no-services";
    if (process.platform !== "darwin") return "launchd available on macOS only";
    const result = await configureLaunchd(envFile);
    return result.map(r => r.label + ": " + r.state).join("; ");
  });
  await step("Server health", async () => {
    if (noServices) return "not started (--no-services)";
    for (let attempt = 0; attempt < (check ? 1 : 20); attempt++) {
      if (await checkHealth()) return "http://127.0.0.1:8787/login";
      if (!check) await new Promise(resolve => setTimeout(resolve, 500));
    }
    const logPath = join(root, ".data", "logs", "server.log");
    let diagnostic = "";
    try {
      const log = await readFile(logPath, "utf8");
      const lines = log.split(/\\r?\\n/).filter(Boolean);
      diagnostic = lines.slice(-12).join(" ").slice(-1200);
    } catch (error) {
      diagnostic = "Server log unavailable: " + String(error.message || error);
    }
    let agentState = "";
    if (process.platform === "darwin") {
      try {
        const state = await exec("launchctl", ["print", "gui/" + process.getuid() + "/io.wenneker.blossom.server"], { timeout: 5000 });
        agentState = String(state.stdout || "").split(/\\r?\\n/).filter(line => /state =|pid =|last exit code =|runs =/.test(line)).join(" ").slice(0, 300);
      } catch (error) { agentState = "launchctl status unavailable: " + String(error.message || error); }
    }
    throw Error("Blossom server did not respond on localhost:8787. " +
      "Check .data/logs/server.log. " + (agentState ? "launchd: " + agentState + ". " : "") +
      "Recent server log: " + (diagnostic || "(empty)"));
  });
  emit("DONE|" + stages + "|Blossom installation checks passed");
  return config;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--check", "--headless", "--yes", "--no-services"].includes(arg))) {
    console.error("Unknown setup argument");
    process.exit(2);
  }
  runSetup({ check: args.includes("--check"), noServices: args.includes("--no-services"),
    emit: line => console.log(line) })
    .catch(error => { console.error("Setup failed:", error.message); process.exitCode = 1; });
}
