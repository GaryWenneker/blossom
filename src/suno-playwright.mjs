import { mkdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { DomainError } from "./domain.mjs";

export const SUNO_CREATE_URL = "https://suno.com/create";
const SAFE_ORIGIN = "https://suno.com";
const BROWSER_PROFILE = ".data/suno-playwright-profile";

/**
 * Supervised browser handoff for the *consumer* Suno website.
 * - Not the separate platform.suno.com developer API
 * - No automated Google sign-in, cookie copying, bot evasion, scraping, or private endpoints
 * - An MP3 is accepted only from Suno's own download menu
 * - The operator completes Google SSO in the visible Chrome window
 */
function preserveCheckFailure(error) {
  if (error instanceof DomainError) throw error;
  if (error?.code === "ERR_ASSERTION" || error?.name === "AssertionError") throw error;
}

export class SunoBrowserHandoff {
  constructor({ profileDir = process.env.BLOSSOM_SUNO_BROWSER_DIR || BROWSER_PROFILE,
    loader = () => import("playwright-core"),
    channel = "chrome" } = {}) {
    this.profileDir = resolve(profileDir);
    this.loader = loader;
    this.channel = channel;
    this.context = null;
    this.page = null;
    this.busy = false;
  }

  status() {
    return {
      kind: "supervised-playwright",
      running: Boolean(this.context),
      site: SUNO_CREATE_URL,
      apiConnected: false,
      requiresManualLogin: true,
      requiresManualGeneration: true
    };
  }

  async open() {
    if (this.busy) throw new DomainError("Suno browser operation already in progress", 409);
    this.busy = true;
    try {
      if (this.context && this.page && !this.page.isClosed()) {
        try {
          await this.page.bringToFront();
          return { ...this.status(), reopened: true };
        } catch { this.context = null; this.page = null; }
      }
      await mkdir(this.profileDir, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.profileDir);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new DomainError("Unsafe Suno browser profile directory", 403);
      let library;
      try { library = await this.loader(); }
      catch (error) {
        preserveCheckFailure(error);
        throw new DomainError("Playwright Core is not installed. Run npm install in Blossom.", 503);
      }
      if (!library?.chromium?.launchPersistentContext)
        throw new DomainError("Playwright Core does not support a persistent Chrome context", 503);
      try {
        this.context = await library.chromium.launchPersistentContext(this.profileDir, {
          headless: false, channel: this.channel, viewport: { width: 1280, height: 880 },
          acceptDownloads: true, serviceWorkers: "block"
        });
      } catch (error) {
        preserveCheckFailure(error);
        const details = String(error.message || "");
        const profileConflict = /SingletonLock|ProcessSingleton|profile.*in use|user data directory is already in use|Target page, context or browser has been closed/i.test(details);
        if (profileConflict) throw new DomainError("Blossom Chrome profile is already in use or Chrome closed during startup. Close the other Blossom Chrome window, then retry. Do not delete profile files while Chrome is running. " + details.slice(0, 160), 409);
        throw new DomainError("Cannot launch Google Chrome with Playwright. Install Chrome, then retry. " +
          String(error.message || "").slice(0, 180), 503);
      }
      this.context.on("close", () => { this.context = null; this.page = null; });
      const page = this.context.pages()[0] || await this.context.newPage();
      this.page = page;
      // Navigate only to the public consumer UI, never to undocumented APIs.
      await page.goto(SUNO_CREATE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.bringToFront();
      return { ...this.status(), reopened: false };
    } finally {
      this.busy = false;
    }
  }

  async prefill(recipe) {
    if (this.busy) throw new DomainError("Suno browser operation already in progress", 409);
    if (!this.page || this.page.isClosed() || !this.context)
      throw new DomainError("Open the supervised Suno browser before filling fields", 409);
    const url = new URL(this.page.url());
    if (url.origin !== SAFE_ORIGIN || !url.pathname.startsWith("/create"))
      throw new DomainError("Sign in with Google and navigate to Suno Create in the opened window first", 409);
    if (!recipe || recipe.provider !== "suno")
      throw new DomainError("A valid Suno production blueprint is required", 400);
    this.busy = true;
    try {
      // These are visible, ordinary browser form controls. No private APIs,
      // authentication pages, browser cookies, DOM scraping or Generate clicks.
      const fields = {
        lyrics: recipe.instrumental ? "" : String(recipe.lyrics || ""),
        styles: String(recipe.style || ""),
        exclude: String(recipe.exclude || ""),
        title: String(recipe.title || "")
      };
      const candidates = {
        lyrics: [
          this.page.getByRole("textbox", { name: /lyrics/i }),
          this.page.locator('textarea[placeholder*="lyrics" i]')
        ],
        styles: [
          this.page.getByRole("textbox", { name: /style(s)?/i }),
          this.page.locator('textarea[placeholder*="style" i]'),
          this.page.locator('input[placeholder*="style" i]')
        ],
        exclude: [
          this.page.getByRole("textbox", { name: /exclude/i }),
          this.page.locator('input[placeholder*="exclude" i]')
        ],
        title: [
          this.page.getByRole("textbox", { name: /^title$/i }),
          this.page.locator('input[placeholder*="title" i]')
        ]
      };
      const filled = [], skipped = [];
      for (const [key, value] of Object.entries(fields)) {
        if (!value) continue;
        let matched = false;
        for (const locator of candidates[key]) {
          // Only fill an unambiguous, visible input. UI changes fail safely.
          if (await locator.count() !== 1 || !await locator.isVisible()) continue;
          await locator.fill(value, { timeout: 8000 });
          filled.push(key);
          matched = true;
          break;
        }
        if (!matched) skipped.push(key);
      }
      return {
        filled, skipped,
        note: "Review all Suno settings in the visible browser. Press Generate yourself. " +
          "If a field was skipped, copy its value from the Blossom blueprint instead.",
        submitted: false
      };
    } finally { this.busy = false; }
  }

  async submit(recipe) {
    const filled=await this.prefill(recipe);
    if(filled.skipped.includes("lyrics") || filled.skipped.includes("styles") || filled.skipped.includes("title"))
      throw new DomainError("Suno changed its form; required fields were not filled: "+filled.skipped.join(", "),409);
    const page=this.page;
    const buttons=[page.getByRole("button",{name:/^create$/i}),page.getByRole("button",{name:/^generate$/i})];
    for(const button of buttons){
      if(await button.count()!==1 || !await button.isVisible() || !await button.isEnabled())continue;
      await button.click({timeout:10000});
      return {submitted:true,filled:filled.filled,note:"Suno creation clicked in your signed-in browser. Check the resulting song in Suno."};
    }
    throw new DomainError("Suno Create button was not uniquely available; review the visible browser",409);
  }

  async downloadSelected(destination) {
    if(!this.page||this.page.isClosed())throw new DomainError("Open Suno first",409);
    const url=new URL(this.page.url());
    if(url.origin!==SAFE_ORIGIN)throw new DomainError("Navigate to Suno to download audio",409);
    const page=this.page;
    const downloadButton=page.getByRole("menuitem",{name:/download.*(mp3|audio)|mp3/i});
    if(await downloadButton.count()!==1 || !await downloadButton.isVisible())
      throw new DomainError("Select exactly one new song in Suno and open its Download menu",409);
    const pending=page.waitForEvent("download",{timeout:45000});
    await downloadButton.click();
    const download=await pending;
    if(!/\.mp3$/i.test(download.suggestedFilename()))
      throw new DomainError("Suno did not provide an MP3 download",409);
    await download.saveAs(destination);
    return {filename:destination,sourceName:download.suggestedFilename()};
  }

  async close() {
    if (this.busy) throw new DomainError("Suno browser operation already in progress", 409);
    if (this.context) {
      const ctx = this.context;
      this.context = null; this.page = null;
      await ctx.close();
    }
    return this.status();
  }
}
