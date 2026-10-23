import { mkdir, lstat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DomainError } from "./domain.mjs";

// These are independent, user-controlled Chrome profiles. We do not read,
// export, import, forward or inject cookies or localStorage into other domains.
const PROVIDERS = Object.freeze({
  spotify: { url: "https://open.spotify.com/", profile: ".data/browser-accounts/spotify" },
  chatgpt: { url: "https://chatgpt.com/", profile: ".data/browser-accounts/chatgpt" }
});

export class VisibleBrowserSession {
  constructor(provider, { profileDir, loader = () => import("playwright-core"),
    channel = "chrome" } = {}) {
    if (!Object.hasOwn(PROVIDERS, provider)) throw new DomainError("Unsupported browser service", 400);
    this.provider = provider;
    this.site = PROVIDERS[provider].url;
    this.profileDir = resolve(profileDir || PROVIDERS[provider].profile);
    this.loader = loader;
    this.channel = channel;
    this.context = null;
    this.page = null;
    this.busy = false;
  }
  status() {
    return {
      provider: this.provider,
      browserOpen: !!this.context && !!this.page && !this.page.isClosed(),
      localProfilePresent: existsSync(this.profileDir),
      website: this.site,
      authenticationVerified: false,
      apiConnected: false,
      note: "A local browser profile may contain cookies, but does not prove you are signed in."
    };
  }
  async open() {
    if (this.busy) throw new DomainError("Browser operation already in progress", 409);
    this.busy = true;
    try {
      if (this.context && this.page && !this.page.isClosed()) {
        await this.page.bringToFront();
        return { ...this.status(), reusedWindow: true };
      }
      await mkdir(this.profileDir, { recursive: true, mode: 0o700 });
      const info = await lstat(this.profileDir);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new DomainError("Unsafe browser profile location", 403);
      let library;
      try { library = await this.loader(); }
      catch { throw new DomainError("Playwright Core is unavailable. Run npm install.", 503); }
      if (!library?.chromium?.launchPersistentContext)
        throw new DomainError("Installed Playwright does not support Chrome profiles", 503);
      let context;
      try {
        context = await library.chromium.launchPersistentContext(this.profileDir, {
          headless: false, channel: this.channel, viewport: { width: 1180, height: 850 },
          acceptDownloads: false
        });
      } catch (error) {
        throw new DomainError("Cannot open Chrome. Close another window using this Blossom browser profile and retry. " +
          String(error.message || "").slice(0, 170), 503);
      }
      this.context = context;
      context.on("close", () => {
        if (this.context === context) { this.context = null; this.page = null; }
      });
      try {
        const page = context.pages()[0] || await context.newPage();
        this.page = page;
        await page.goto(this.site, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.bringToFront();
      } catch (error) {
        this.context = null; this.page = null;
        await context.close().catch(() => {});
        throw new DomainError("Could not open the official " + this.provider + " website: " +
          String(error.message || "").slice(0, 180), 503);
      }
      return { ...this.status(), reusedWindow: false };
    } finally { this.busy = false; }
  }
  async close() {
    if (this.busy) throw new DomainError("Browser operation already in progress", 409);
    if (this.context) {
      const context = this.context;
      this.context = null; this.page = null;
      await context.close();
    }
    // Chromium persists the provider's own encrypted/opaque profile storage;
    // never delete it on close, and never treat it as an API bearer token.
    return this.status();
  }
}

export class ConnectedBrowsers {
  constructor({ suno, spotify, chatgpt } = {}) {
    if (!suno) throw new Error("Existing supervised Suno browser is required");
    this.suno = suno;
    this.spotify = spotify || new VisibleBrowserSession("spotify");
    this.chatgpt = chatgpt || new VisibleBrowserSession("chatgpt");
  }
  instance(provider) {
    if (!["suno", "spotify", "chatgpt"].includes(provider))
      throw new DomainError("Unsupported browser provider", 404);
    return this[provider];
  }
  async status() {
    const suno = this.suno.status();
    return {
      suno: {
        provider: "suno", browserOpen: !!suno.running,
        localProfilePresent: existsSync(this.suno.profileDir),
        website: "https://suno.com/create", authenticationVerified: false, apiConnected: false
      },
      spotify: this.spotify.status(),
      chatgpt: this.chatgpt.status()
    };
  }
  async open(provider) {
    const result = await this.instance(provider).open();
    // Existing Suno class returns "running" and "reopened". Preserve API compatibility
    // while exposing one normalized provider-browser result to Connections.
    return provider === "suno"
      ? { provider, browserOpen: !!result.running,
          localProfilePresent: existsSync(this.suno.profileDir),
          reusedWindow: !!result.reopened, authenticationVerified: false, apiConnected: false }
      : result;
  }
  async close(provider) {
    await this.instance(provider).close();
    return (await this.status())[provider];
  }
  async closeAll() {
    await Promise.allSettled(["suno", "spotify", "chatgpt"].map(provider => this.instance(provider).close()));
  }
}
