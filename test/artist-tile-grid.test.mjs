import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { artistPage, artistSearchState, paintArtistSearch } from "../public/artists.js";

const countries = [
  { code: "US", name: "United States" },
  { code: "NL", name: "Netherlands" }
];

const evan = {
  id: "evan", name: "Evan Mercer", genre: "Country Pop", language: "en",
  countries: ["US"], voice: "male", dna: "Intimate baritone and guitar."
};
const lotte = {
  id: "lotte", name: "Lotte Veld", genre: "Indie Folk", language: "nl",
  countries: ["NL"], voice: "female", dna: "Close harmonies and a quiet room."
};

function page(artists = [evan, lotte]) {
  return artistPage({ artists, countries, genres: {}, artistBanners: {}, artistImages: {} });
}

test("search matches name, genre, and country display name, and ignores voice and language", () => {
  const artists = [evan, lotte];
  assert.deepEqual(artistSearchState(artists, countries, "merc").visibleIds, ["evan"]);
  assert.deepEqual(artistSearchState(artists, countries, "COUNTRY").visibleIds, ["evan"]);
  assert.deepEqual(artistSearchState(artists, countries, "united").visibleIds, ["evan"]);
  assert.deepEqual(artistSearchState(artists, countries, "netherlands").visibleIds, ["lotte"]);
  assert.deepEqual(artistSearchState(artists, countries, "zzz").visibleIds, []);
  assert.deepEqual(artistSearchState(artists, countries, "male").visibleIds, []);
  assert.deepEqual(artistSearchState(artists, countries, "nl").visibleIds, []);
  assert.deepEqual(artistSearchState(artists, countries, "  ").visibleIds, ["evan", "lotte"]);
  assert.deepEqual(artistSearchState(artists, countries, "  merc  ").visibleIds, ["evan"]);
});

test("roster count and empty text follow the query", () => {
  const artists = [evan, lotte];
  assert.equal(artistSearchState(artists, countries, "").countText, "(2)");
  assert.equal(artistSearchState(artists, countries, "   ").countText, "(2)");
  assert.equal(artistSearchState(artists, countries, "merc").countText, "(1 of 2)");
  assert.equal(artistSearchState(artists, countries, "zzz").emptyText, "No artists match “zzz”.");
  assert.equal(artistSearchState(artists, countries, "  <img>  ").emptyText, "No artists match “<img>”.");
  assert.equal(artistSearchState(artists, countries, "merc").emptyText, "");
  assert.equal(artistSearchState([], countries, "zzz").emptyText, "");
});

test("painting a search result hides non-matches and writes the empty text as text", () => {
  const cards = [
    { dataset: { artistId: "evan" }, hidden: false },
    { dataset: { artistId: "lotte" }, hidden: false }
  ];
  const count = { textContent: "" };
  const empty = { textContent: "stale", hidden: true };
  paintArtistSearch(cards, count, empty, artistSearchState([evan, lotte], countries, "<img>"));
  assert.equal(cards[0].hidden, true);
  assert.equal(cards[1].hidden, true);
  assert.deepEqual(cards.map(card => card.dataset.artistId), ["evan", "lotte"]);
  assert.equal(count.textContent, "(0 of 2)");
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, "No artists match “<img>”.");
});

test("the artists page has a search field, tile actions, and keeps photo controls in the card details", () => {
  const html = page();
  assert.match(html, /<label for="artist-search">Search artists<\/label>/);
  assert.match(html, /<input id="artist-search"[^>]*placeholder="Name, genre, or country"/);
  assert.match(html, /id="artist-roster-count">\(2\)/);
  assert.match(html, /id="artist-search-empty" hidden/);
  assert.match(html, /<article class="artist-card artist-banner-card" data-artist-id="evan">/);
  assert.match(html, /class="artist-tile-actions"[\s\S]*?data-action="artist-edit"[\s\S]*?data-artist-id="evan"[\s\S]*?>Edit artist</);
  assert.match(html, /class="artist-tile-actions"[\s\S]*?data-action="artist-image-generate"[\s\S]*?>Generate banner</);
  assert.match(html, /class="artist-tile-actions"[\s\S]*?data-action="artist-photos-open"[\s\S]*?>Manage photos</);
  assert.match(html, /id="artist-photos-dialog"/);
  assert.match(html, /id="artist-photos-title"/);
  assert.match(html, /data-action="artist-photos-close"/);
  assert.match(html, /class="artist-banner-details"[\s\S]*?Intimate baritone and guitar/);
  assert.match(html, /class="artist-banner-details"[\s\S]*?id="artist-photo-prompt-evan"/);
  assert.match(html, /class="artist-banner-details"[\s\S]*?Generate artist banner/);
  assert.match(html, /No artists match/.source ? /^(?![\s\S]*No artists match)/ : /$^/);
  assert.equal(html.includes("No artists match"), false);
});

test("a wide tile shows part of the artist DNA and keeps the full note for hover", () => {
  const html = page([{ ...evan, dna: "Warm <b>room</b> and a long note." }]);
  assert.match(html, /class="artist-tile-dna" tabindex="0">/);
  assert.match(html, /class="artist-tile-dna-preview">Warm &lt;b&gt;room&lt;\/b&gt; and a long note\.<\/p>/);
  assert.match(html, /class="artist-tile-dna-full" aria-hidden="true">Warm &lt;b&gt;room&lt;\/b&gt; and a long note\.<\/div>/);
  assert.equal(html.includes("Warm <b>room</b>"), false);
});

test("a name that looks like markup is escaped on the tile", () => {
  const html = page([{ ...evan, name: "<img>" }]);
  assert.equal(html.includes("<h3><img></h3>"), false);
  assert.match(html, /<h3>&lt;img&gt;<\/h3>/);
});

test("wide screens use a 16:9 tile grid and narrow screens keep the banner details", async () => {
  const css = await readFile(new URL("../public/viewport.css", import.meta.url), "utf8");
  assert.match(css, /\.artist-tile-actions\{display:none\}/);
  assert.match(css, /\.artist-tile-dna\{display:none\}/);
  const start = css.indexOf("@media (min-width: 960px)");
  assert.notEqual(start, -1);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  const wide = css.slice(open + 1, end);
  assert.match(wide, /repeat\(auto-fill, minmax\(280px, 1fr\)\)/);
  assert.match(wide, /\.artist-hero\{[^}]*aspect-ratio:16\/9/);
  assert.match(wide, /\.artist-banner-details\{display:none\}/);
  assert.match(wide, /\.artist-tile-actions\{[^}]*display:flex/);
  assert.match(wide, /\.artist-tile-actions\{[^}]*flex-wrap:wrap/);
  assert.match(wide, /\.artist-tile-actions button,\s*body\[data-view="artists"\] \.artist-tile-actions \.studio-upload\{[^}]*white-space:normal/);
  assert.match(wide, /\.artist-tile-actions button,\s*body\[data-view="artists"\] \.artist-tile-actions \.studio-upload\{[^}]*flex:1 1 calc\(50% - 6px\)/);
  assert.match(wide, /#artist-photos-dialog \.artist-banner-details\{display:block\}/);
  assert.match(wide, /#artist-photos-dialog \.artist-banner-bio\{display:none\}/);
  assert.match(wide, /\.artist-tile-dna\{display:block/);
  assert.match(wide, /-webkit-line-clamp:3/);
  assert.match(wide, /\.artist-banner-card\{[^}]*position:relative/);
  assert.doesNotMatch(wide, /overflow:visible/);
  assert.doesNotMatch(wide, /top:100%/);
  assert.match(wide, /\.artist-tile-dna-full\{[^}]*position:absolute[^}]*top:8px[^}]*bottom:52px/);
  assert.match(wide, /\.artist-tile-dna-full\{[^}]*background:#141b1880[^}]*-webkit-backdrop-filter:blur\(16px\)[^}]*backdrop-filter:blur\(16px\)[^}]*color:#e7f1e9/);
  assert.match(wide, /\.artist-tile-dna:hover \.artist-tile-dna-full,\s*body\[data-view="artists"\] \.artist-tile-dna:focus-within \.artist-tile-dna-full\{display:block\}/);
});
