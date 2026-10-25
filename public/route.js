export const PAGES = ["studio", "music-dna", "overview", "artists", "tracks", "releases",
  "intelligence", "genres", "connections", "compliance", "player"];

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export function pageFromHash(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  const path = raw.split("?")[0];
  if (path === "player" || path.startsWith("player/")) return "player";
  return PAGES.includes(raw) ? raw : "studio";
}

export function hashForPage(page) {
  return PAGES.includes(page) ? "#" + page : "";
}

export function routeFromClick(control = {}) {
  const tab = control?.tab;
  if (!tab || control.action === "studio-bottom-tab" || !PAGES.includes(tab)) return null;
  return { page: tab, hash: hashForPage(tab) };
}

function offsetFrom(query) {
  const raw = query.get("offset");
  if (raw === null || raw === "") return 0;
  if (!/^\d+$/.test(raw)) return 0;
  const offset = Number(raw);
  return offset <= 1_000_000 ? offset : 0;
}

export function playerRoute(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  const splitAt = raw.indexOf("?");
  const path = splitAt === -1 ? raw : raw.slice(0, splitAt);
  const query = new URLSearchParams(splitAt === -1 ? "" : raw.slice(splitAt + 1));
  if (path !== "player" && !path.startsWith("player/")) return null;
  const parts = path.split("/");
  if (parts.length === 1) return { view: "home" };
  if (parts.length === 3 && parts[1] === "collection" && parts[2] === "tracks")
    return { view: "liked", offset: offsetFrom(query) };
  if (parts.length === 3 && parts[1] === "playlist" && SPOTIFY_ID.test(parts[2]))
    return { view: "playlist", id: parts[2], offset: offsetFrom(query) };
  if (parts.length === 3 && parts[1] === "artist" && SPOTIFY_ID.test(parts[2]))
    return { view: "artist", id: parts[2] };
  if (parts.length === 3 && parts[1] === "album" && SPOTIFY_ID.test(parts[2]))
    return { view: "album", id: parts[2], offset: offsetFrom(query) };
  if (parts.length === 2 && parts[1] === "search")
    return { view: "search", q: (query.get("q") || "").slice(0, 100) };
  const catalogId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (parts.length === 4 && parts[1] === "catalog" && catalogId.test(parts[3])) {
    if (parts[2] === "artist") return { view: "catalog-artist", id: parts[3] };
    if (parts[2] === "album") return { view: "catalog-album", id: parts[3] };
  }
  return { view: "invalid" };
}
