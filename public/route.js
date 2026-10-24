export const PAGES = ["studio", "music-dna", "overview", "artists", "tracks", "releases",
  "intelligence", "genres", "connections", "compliance"];

export function pageFromHash(hash) {
  const name = String(hash ?? "").replace(/^#/, "");
  return PAGES.includes(name) ? name : "studio";
}

export function hashForPage(page) {
  return PAGES.includes(page) ? "#" + page : "";
}

export function routeFromClick(control = {}) {
  const tab = control?.tab;
  if (!tab || control.action === "studio-bottom-tab" || !PAGES.includes(tab)) return null;
  return { page: tab, hash: hashForPage(tab) };
}
