import { spawn } from "node:child_process";
import { DomainError } from "./domain.mjs";

// The model shown in the user's Draw Things installation.
// Treat it as a preference, not proof it is available to the CLI.
export const PREFERRED_DRAW_MODEL = "lustifySDXLNSFWSFW_v20";
export const DRAW_CLI_COMMAND = "draw-things-cli";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,119}$/;

export function validateDrawModelId(value) {
  if (typeof value !== "string" || !MODEL_ID.test(value))
    throw new DomainError("Invalid BLOSSOM_DRAW_MODEL identifier; use the exact local Draw Things model ID");
  return value;
}

// Output may be a table or a human-readable list, depending on CLI release.
// Match complete identifiers, never substrings (model_v2 must not match model_v20).
export function modelFromDownloadedList(output, requested = PREFERRED_DRAW_MODEL) {
  validateDrawModelId(requested);
  const tokens = String(output || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .match(/[A-Za-z0-9][A-Za-z0-9_.-]{2,159}/g) || [];
  const lookup = new Set(tokens);
  if (lookup.has(requested)) return requested;
  if (!/\.[A-Za-z0-9]+$/.test(requested)) {
    for (const suffix of [".ckpt", ".safetensors"]) {
      if (lookup.has(requested + suffix)) return requested + suffix;
    }
  }
  return null;
}

// Only reads local inventory. Never downloads models or invokes inference.
export function listDownloadedDrawModels({ command = DRAW_CLI_COMMAND, runner = spawn,
  timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = runner(command, ["models", "list", "--downloaded-only"],
        { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(new DomainError("Draw Things CLI cannot start: " + error.message, 503));
      return;
    }
    let output = "", errors = "", size = 0, settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        try { child.kill("SIGKILL"); } catch {}
        reject(error);
      } else resolve(result);
    };
    const timeout = setTimeout(() => finish(new DomainError(
      "Draw Things model inventory timed out", 504)), timeoutMs);
    child.stdout.on("data", chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) return finish(new DomainError("Draw Things model listing is too large", 502));
      output += String(chunk);
    });
    child.stderr.on("data", chunk => { errors = (errors + String(chunk)).slice(-1000); });
    child.once("error", error => finish(new DomainError(
      "Draw Things CLI unavailable. Install it from Homebrew core with: brew install draw-things-cli. " + error.message, 503)));
    child.once("close", code => {
      if (code !== 0) return finish(new DomainError(
        "Could not list locally downloaded Draw Things models: " + (errors || code).toString().slice(0,350), 503));
      finish(null, output);
    });
  });
}

export async function verifyDrawModel(model, options = {}) {
  validateDrawModelId(model);
  const listing = await listDownloadedDrawModels(options);
  const exact = modelFromDownloadedList(listing, model);
  if (!exact) throw new DomainError(
    'Draw Things model "' + model + '" is not in the CLI downloaded model inventory. ' +
    'Open Draw Things and verify it is fully downloaded, then run ' +
    '"draw-things-cli models list --downloaded-only". ' +
    'Set BLOSSOM_DRAW_MODEL to the exact listed ID, or configure DRAWTHINGS_MODELS_DIR to the model directory.', 503);
  return exact;
}
