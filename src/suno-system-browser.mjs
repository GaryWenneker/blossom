import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DomainError } from "./domain.mjs";

export const SUNO_CREATE_URL = "https://suno.com/create";
const SCRIPT = new URL("../scripts/suno-safari-create.applescript", import.meta.url);

/**
 * Opens the normal Safari application. Playwright Chrome is rejected by
 * Google, and Chrome blocks page scripts until a developer menu is enabled.
 * Safari already runs Apple Event JavaScript for Blossom. This path does not
 * spoof bot flags, copy cookies, or press a Google sign-in control.
 */
export function selectedCoverFile(studio, projectId, assetDir) {
  const project = studio.project(projectId);
  const own = studio.assets(projectId).find(asset => asset.kind === "cover" && asset.selected &&
    (!project?.artistId || asset.artistId === project.artistId));
  const fallback = !own && project?.artistId ? studio.artistCovers()[project.artistId] : null;
  const id = own?.id || fallback?.assetId;
  if (!id) return null;
  const row = studio.asset(id);
  if (!row || row.kind !== "cover") return null;
  if (own && row.project_id !== projectId) return null;
  if (!/^[0-9a-f-]{36}\.(?:png|jpg)$/.test(row.filename)) return null;
  return join(assetDir, row.filename);
}

export function selectedTrackArtFile(studio, projectId, assetDir) {
  const own = studio.assets(projectId).find(asset => asset.kind === "track-art" && asset.selected);
  if (!own) return null;
  const row = studio.asset(own.id);
  if (!row || row.kind !== "track-art" || row.project_id !== projectId) return null;
  if (!/^[0-9a-f-]{36}\.(?:png|jpg)$/.test(row.filename)) return null;
  return join(assetDir, row.filename);
}

export function sunoImageFile(studio, projectId, assetDir) {
  return selectedTrackArtFile(studio, projectId, assetDir) || selectedCoverFile(studio, projectId, assetDir);
}

export function buildSunoCoverScript(recipe) {
  const title = String(recipe?.title || "");
  return `(()=>{const title=${JSON.stringify(title)};const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.visibility!=="hidden"&&s.display!=="none"&&r.width>8&&r.height>8};const leaf=label=>[...document.querySelectorAll("span")].find(el=>el.childNodes.length===1&&el.textContent.trim()===label&&el.getBoundingClientRect().height>8);const image=[...document.querySelectorAll('input[type=file]')].find(el=>(el.accept||"").includes("image/"));if(image){image.id="blossom-cover-file";return"COVER_OPEN";}const details=leaf("Song Details");if(details){(details.closest("button")||details).click();return"COVER_WAIT";}const manage=leaf("Manage");if(manage){(manage.closest("button")||manage).click();return"COVER_WAIT";}const rowHasTitle=el=>{let node=el;for(let i=0;i<8&&node;i++){const text=(node.innerText||"").replace(/\\s+/g," ").trim();if(title&&text.includes(title)&&text.length<250)return true;node=node.parentElement;}return false};const button=[...document.querySelectorAll('button[aria-label="More options"]')].find(el=>shown(el)&&el.dataset.blossomSeen!=="1"&&rowHasTitle(el));if(!button)return"COVER_WAIT";button.dataset.blossomSeen="1";button.click();return"COVER_WAIT";})()`;
}

export function buildSunoClipScript(recipe, { placeImage = true, existing = false } = {}) {
  const title = JSON.stringify(String(recipe?.title || ""));
  const place = placeImage ? "true" : "false";
  const includeExisting = existing ? "true" : "false";
  return `(()=>{const title=${title};const placeImage=${place};const existing=${includeExisting};const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.visibility!=="hidden"&&s.display!=="none"&&r.width>8&&r.height>8};const leaf=label=>[...document.querySelectorAll("span")].find(el=>el.childNodes.length===1&&el.textContent.trim()===label&&shown(el));const rows=[...document.querySelectorAll('[data-testid="clip-row"]')].filter(row=>row.getAttribute("aria-label")===title&&row.getAttribute("data-clip-status")==="complete"&&row.dataset.blossomDone!=="1");const fresh=rows.filter(row=>{const button=row.querySelector('button[aria-label="More options"]');return button&&button.dataset.blossomSeen!=="1"});const pool=(existing?rows:(fresh.length?fresh:(window.__blossomMarked?[]:rows))).slice(0,2);const done=[...document.querySelectorAll('[data-testid="clip-row"]')].filter(row=>row.getAttribute("aria-label")===title&&row.dataset.blossomDone==="1");if(!pool.length)return done.length>=2||(done.length&&!window.__blossomMarked)?"CLIPS_DONE":"CLIP_WAIT";const row=pool[0];const step=row.dataset.blossomStep||"";const click=(el)=>{(el.closest("[role=menuitem]")||el.closest("button")||el).click()};const image=[...document.querySelectorAll('input[type=file]')].find(el=>(el.accept||"").includes("image/"));if(placeImage&&step==="details"&&image){image.id="blossom-cover-file";return"COVER_OPEN";}if(placeImage&&step==="details"){const waits=Number(row.dataset.blossomWaits||"0")+1;row.dataset.blossomWaits=String(waits);if(waits>4){row.dataset.blossomStep="audio";row.dataset.blossomWaits="0";}return"COVER_WAIT";}const details=leaf("Song Details");if(placeImage&&step==="manage"&&details){click(details);row.dataset.blossomStep="details";row.dataset.blossomWaits="0";return"COVER_WAIT";}if(placeImage&&step==="manage"){const waits=Number(row.dataset.blossomWaits||"0")+1;row.dataset.blossomWaits=String(waits);if(waits>4){row.dataset.blossomStep="audio";row.dataset.blossomWaits="0";}return"COVER_WAIT";}const manage=leaf("Manage");if(placeImage&&step==="menu"&&manage){click(manage);row.dataset.blossomStep="manage";return"COVER_WAIT";}const mp3=[...document.querySelectorAll("button")].find(el=>shown(el)&&[...el.querySelectorAll("span")].some(span=>span.childNodes.length===1&&span.textContent.trim()==="MP3"));const unlock=[...document.querySelectorAll("button")].find(el=>shown(el)&&/^(?:Unlock & Download|Download)$/.test((el.innerText||"").replace(/\s+/g," ").trim()));if(step==="download"&&mp3){mp3.click();row.dataset.blossomStep="format";return"COVER_WAIT";}if(step==="format"&&unlock){unlock.click();row.dataset.blossomStep="downloading";return"DOWNLOAD_CLICKED";}if(step==="download"||step==="format")return"COVER_WAIT";const download=[...document.querySelectorAll('[role=menuitem]')].find(el=>shown(el)&&((el.getAttribute("aria-label")||"").trim()==="Download"));if(step==="audio"&&download){download.click();row.dataset.blossomStep="download";return"COVER_WAIT";}const more=row.querySelector('button[aria-label="More options"]');if(!more)return"CLIP_WAIT";if(!step){row.dataset.blossomStep=placeImage?"menu":"audio";more.click();return"COVER_WAIT";}if(step==="saved"){row.dataset.blossomStep="audio";more.click();return"COVER_WAIT";}if((step==="menu"||step==="audio")&&!document.querySelector("[role=menu]")){more.click();return"COVER_WAIT";}return"COVER_WAIT";})()`;
}

export function parseSunoHarvest(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const status = lines[0] || "";
  if (!["CREATED", "CREATED_COVER", "CREATED_NOCOVER"].includes(status))
    throw new DomainError("Suno did not finish the generated songs", 409);
  const audioFiles = lines.slice(1).filter(line => line.startsWith("/") && line.endsWith(".mp3") && !/[\r\n\0]/.test(line));
  const art = status === "CREATED_COVER" ? "attached" : status === "CREATED_NOCOVER" ? "missing" : "none";
  return { art, audioFiles };
}

export function isMp3(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 128 &&
    (bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224));
}

export async function acceptedSunoMp3s(paths, { home = homedir() } = {}) {
  if (!Array.isArray(paths)) return [];
  const root = await realpath(home);
  const prefix = root.endsWith(sep) ? root : root + sep;
  const accepted = [];
  for (const candidate of paths) {
    if (typeof candidate !== "string" || !candidate.startsWith("/") || !candidate.endsWith(".mp3")) continue;
    let info;
    try { info = await lstat(candidate); }
    catch { continue; }
    if (!info.isFile() || info.isSymbolicLink() || info.size < 128 || info.size > 80 * 1024 * 1024) continue;
    const file = await realpath(candidate);
    if (!file.startsWith(prefix) || accepted.includes(file)) continue;
    const bytes = await readFile(file);
    if (!isMp3(bytes)) continue;
    accepted.push(file);
  }
  return accepted;
}

export async function titleDownloadMp3s(title, { home = homedir(), downloads } = {}) {
  const name = String(title || "").trim();
  if (!name || /[/\0]/.test(name)) return [];
  const folder = downloads || join(home, "Downloads");
  let entries;
  try { entries = await readdir(folder); }
  catch { return []; }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("^" + escaped + "(?:-(\\d+))?\\.mp3$", "i");
  const matches = entries.filter(entry => pattern.test(entry)).map(entry => join(folder, entry));
  const accepted = await acceptedSunoMp3s(matches, { home });
  const ranked = [];
  for (const file of accepted) ranked.push({ file, mtime: (await stat(file)).mtimeMs });
  ranked.sort((left, right) => right.mtime - left.mtime || left.file.localeCompare(right.file));
  return ranked.slice(0, 2).map(item => item.file);
}

export async function copySunoMp3s(paths, { assetDir, home = homedir() } = {}) {
  if (!Array.isArray(paths)) return [];
  const root = await realpath(home);
  const prefix = root.endsWith(sep) ? root : root + sep;
  await mkdir(assetDir, { recursive: true, mode: 0o700 });
  const saved = [];
  for (const candidate of paths) {
    if (typeof candidate !== "string" || !candidate.startsWith("/") || !candidate.endsWith(".mp3")) continue;
    let info;
    try { info = await lstat(candidate); }
    catch { continue; }
    if (!info.isFile() || info.isSymbolicLink() || info.size > 80 * 1024 * 1024) continue;
    const file = await realpath(candidate);
    if (!file.startsWith(prefix)) continue;
    const bytes = await readFile(file);
    if (!isMp3(bytes)) continue;
    const filename = randomUUID() + ".mp3";
    await writeFile(join(assetDir, filename), bytes, { flag: "wx", mode: 0o600 });
    saved.push(filename);
  }
  return saved;
}

export function buildSunoCreateScript(recipe, { click = true } = {}) {
  const fields = {
    click,
    lyrics: recipe?.instrumental ? "" : String(recipe?.lyrics || ""),
    styles: String(recipe?.style || ""),
    exclude: String(recipe?.exclude || ""),
    title: String(recipe?.title || "")
  };
  return `(()=>{const recipe=${JSON.stringify(fields)};if(location.hostname!=="suno.com"||!location.pathname.startsWith("/create"))return"WRONG_HOST";const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.visibility!=="hidden"&&s.display!=="none"&&r.width>0&&r.height>0};const nameOf=el=>((el.getAttribute("aria-label")||el.innerText||el.getAttribute("placeholder")||"").replace(/\\s+/g," ").trim());const controls=[...document.querySelectorAll("button,[role=button]")];if(controls.some(el=>shown(el)&&/continue with google/i.test(nameOf(el)))&&!controls.some(el=>shown(el)&&/create song/i.test(el.getAttribute("aria-label")||"")))return"LOGIN";const writeField=(el,value)=>{if(el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement){const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));return true;}if(el.isContentEditable||el.getAttribute("role")==="textbox"){el.focus();const sel=window.getSelection();const range=document.createRange();range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range);if(!document.execCommand("insertText",false,value)){el.textContent=value;el.dispatchEvent(new InputEvent("input",{bubbles:true}));}return true;}return false};const lyrics=[...document.querySelectorAll('[role="textbox"],textarea')].filter(el=>/lyrics/i.test(nameOf(el))).filter(shown);if(recipe.lyrics&&!lyrics.length)return"WAIT";if(recipe.lyrics&&!writeField(lyrics[0],recipe.lyrics))return"MISSING:lyrics";const styleBoxes=[...document.querySelectorAll("textarea")].filter(el=>{if(!shown(el))return false;const blob=nameOf(el);if(/cowriter|script|tone|speech|delivery/i.test(blob))return false;return /,/.test(el.getAttribute("placeholder")||"")||/sound|style/i.test(blob);});const advanced=styleBoxes.filter(el=>/,/.test(el.getAttribute("placeholder")||""));const styles=advanced.length?advanced:styleBoxes;if(recipe.styles&&!styles.length)return"WAIT";for(const el of styles)if(!writeField(el,recipe.styles))return"MISSING:styles";const titles=[...document.querySelectorAll("input")].filter(el=>shown(el)&&/song title/i.test(el.getAttribute("placeholder")||""));if(recipe.title&&!titles.length)return"MISSING:title";for(const el of titles)if(!writeField(el,recipe.title))return"MISSING:title";const excludes=[...document.querySelectorAll("input")].filter(el=>shown(el)&&/exclude/i.test(el.getAttribute("placeholder")||el.getAttribute("aria-label")||""));for(const el of excludes)if(recipe.exclude&&!writeField(el,recipe.exclude))return"MISSING:exclude";if(!recipe.click)return"FILLED";const buttons=controls.filter(el=>shown(el)&&/^create song$/i.test(nameOf(el)));const enabled=buttons.filter(el=>!el.disabled&&el.getAttribute("aria-disabled")!=="true"&&el.getAttribute("data-disabled")==null);if(!buttons.length)return"WAIT";if(enabled.length!==1)return"DISABLED";if(!window.__blossomMarked){document.querySelectorAll('button[aria-label="More options"]').forEach(el=>{el.dataset.blossomSeen="1";});window.__blossomMarked=1;}return"READY";})()`;
}

async function localCover(coverFile) {
  if (coverFile == null || coverFile === "") return null;
  const value = String(coverFile);
  if (!value.startsWith("/") || !/\.(?:png|jpg)$/.test(value) || /[\r\n\0"]/.test(value))
    throw new DomainError("Suno image path is not a local PNG or JPEG", 400);
  let info;
  try { info = await lstat(value); }
  catch { throw new DomainError("Album cover file is missing", 400); }
  if (!info.isFile() || info.isSymbolicLink())
    throw new DomainError("Album cover path is not a local PNG", 400);
  return value;
}

export class SunoSystemBrowser {
  constructor({ launcher = execFile, platform = process.platform } = {}) {
    this.launcher = launcher;
    this.platform = platform;
  }

  status() {
    return {
      kind: "system-safari",
      running: false,
      site: SUNO_CREATE_URL,
      apiConnected: false,
      requiresManualLogin: true,
      requiresManualGeneration: false,
      application: "Safari"
    };
  }

  run(command, args, timeout) {
    if (this.platform !== "darwin")
      throw new DomainError("Suno in the normal Safari app is available only on macOS", 501);
    return new Promise((resolve, reject) => {
      this.launcher(command, args, { timeout, windowsHide: true, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
        if (error) {
          error.stderr = String(stderr || "");
          reject(error);
        } else resolve(String(stdout || ""));
      });
    });
  }

  async open() {
    await this.run("/usr/bin/open", ["-a", "Safari", SUNO_CREATE_URL], 12_000);
    return { ...this.status(), launched: true };
  }

  async prefill(recipe) {
    const filled = await this.submit(recipe, { click: false });
    return { ...filled, submitted: false };
  }

  async submit(recipe, { click = true, coverFile = null } = {}) {
    if (!recipe || recipe.provider !== "suno")
      throw new DomainError("A valid Suno production blueprint is required", 400);
    const cover = await localCover(coverFile);
    const script = buildSunoCreateScript(recipe, { click });
    const args = [fileURLToPath(SCRIPT), script];
    if (cover && click) args.push(buildSunoCoverScript(recipe), cover);
    let stdout = "";
    try {
      stdout = await this.run("/usr/bin/osascript", args, cover ? 120_000 : 45_000);
    } catch (error) {
      const details = String(error?.stderr || error?.message || "");
      if (/Allow JavaScript from Apple Events|-1743|JavaScript/i.test(details))
        throw new DomainError("Turn on Safari Settings → Developer → Allow JavaScript from Apple Events, then generate again.", 409);
      throw new DomainError("Could not use the normal Safari window. " + details.slice(0, 180), 503);
    }
    const text = stdout.trim();
    if (text === "LOGIN" || text.startsWith("LOGIN"))
      throw new DomainError("Sign in with Google in the Safari window, then generate again. Blossom does not sign in through Playwright.", 409);
    if (text.startsWith("MISSING:"))
      throw new DomainError("Suno changed its form; required fields were not filled: " + text.slice("MISSING:".length), 409);
    if (text === "NOBUTTON")
      throw new DomainError("Suno Create button was not uniquely available in the Safari window", 409);
    if (text === "DISABLED")
      throw new DomainError("Safari filled the song, but Suno's Generate button is disabled. Check that you are signed in and have credits, then press Create song in that window.", 409);
    if (text === "WRONG_HOST")
      throw new DomainError("Open https://suno.com/create in Safari before generating.", 409);
    if (text !== "CREATED" && text !== "CREATED_COVER" && text !== "CREATED_NOCOVER" && text !== "FILLED")
      throw new DomainError("Suno create page did not accept the blueprint", 409);
    const filled = ["lyrics", "styles", "exclude", "title"].filter(key => {
      const value = key === "styles" ? recipe.style : key === "exclude" ? recipe.exclude : recipe[key];
      return key === "lyrics" ? !recipe.instrumental && String(value || "").trim() : String(value || "").trim();
    });
    const coverState = !cover || !click ? "none" : text === "CREATED_COVER" ? "attached" : "missing";
    const note = text === "FILLED"
      ? "The blueprint was filled in Safari."
      : coverState === "attached"
        ? "Create was clicked in Safari, and the selected album cover was attached to the new song."
        : coverState === "missing"
          ? "Create was clicked in Safari. The album cover was not attached. On the new song, choose Manage, then Song Details, and upload the cover."
          : "Create was clicked in Safari. No album cover is selected in Studio, so Suno kept its own image.";
    return { submitted: text !== "FILLED", filled, skipped: [], cover: coverState, note };
  }

  async harvest(recipe, { imageFile = null, existing = false } = {}) {
    if (!recipe || recipe.provider !== "suno")
      throw new DomainError("A valid Suno production blueprint is required", 400);
    const image = await localCover(imageFile);
    const script = buildSunoClipScript(recipe, { placeImage: !!image, existing });
    const args = [fileURLToPath(SCRIPT), "harvest", script];
    if (image) args.push(image);
    let stdout = "";
    try {
      stdout = await this.run("/usr/bin/osascript", args, 300_000);
    } catch (error) {
      const details = String(error?.stderr || error?.message || "");
      if (/Allow JavaScript from Apple Events|-1743|JavaScript/i.test(details))
        throw new DomainError("Turn on Safari Settings → Developer → Allow JavaScript from Apple Events, then generate again.", 409);
      throw new DomainError("Could not collect the generated Suno songs. " + details.slice(0, 180), 503);
    }
    return parseSunoHarvest(stdout);
  }

  async downloadSelected(destination, { recipe = null, imageFile = null, home = homedir() } = {}) {
    const saved = await titleDownloadMp3s(recipe?.title, { home });
    if (saved.length) {
      await writeFile(destination, await readFile(saved[0]), { flag: "wx", mode: 0o600 });
      return { filename: destination, sourceName: saved[0], art: "none", audioFiles: saved };
    }
    const harvested = await this.harvest(recipe, { imageFile, existing: true });
    const audioFiles = await acceptedSunoMp3s(harvested.audioFiles, { home });
    if (!audioFiles.length)
      throw new DomainError("Suno did not download the MP3.", 409);
    await writeFile(destination, await readFile(audioFiles[0]), { flag: "wx", mode: 0o600 });
    return { filename: destination, sourceName: audioFiles[0], art: harvested.art, audioFiles };
  }

  async close() {
    return this.status();
  }
}
