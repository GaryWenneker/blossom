import { savedFocus } from "./artist-focus.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

function searchNeedle(query) {
  return String(query ?? "").trim();
}

export function artistSearchState(artists, countries, query) {
  const list = artists || [];
  const needle = searchNeedle(query).toLowerCase();
  const names = new Map((countries || []).map(country => [country.code, country.name]));
  const visible = needle ? list.filter(artist => {
    const fields = [artist?.name, artist?.genre, ...(artist?.countries || []).map(code => names.get(code) || code)];
    return fields.some(field => String(field ?? "").toLowerCase().includes(needle));
  }) : list;
  const filtering = needle.length > 0;
  return {
    visibleIds: visible.map(artist => artist.id),
    countText: filtering ? `(${visible.length} of ${list.length})` : `(${list.length})`,
    emptyText: filtering && list.length > 0 && visible.length === 0
      ? `No artists match “${searchNeedle(query)}”.`
      : ""
  };
}

export function paintArtistSearch(cards, countEl, emptyEl, result) {
  const visible = new Set(result.visibleIds);
  for (const card of cards) card.hidden = !visible.has(card.dataset.artistId);
  countEl.textContent = result.countText;
  emptyEl.textContent = result.emptyText;
  emptyEl.hidden = result.emptyText === "";
}

function draftPicker(artists) {
  const boxes = (artists || []).map(item =>
    '<label><input type="checkbox" name="draftArtist" value="' + escapeHtml(item.id) + '"> ' + escapeHtml(item.name) + "</label>").join("");
  const roster = boxes
    ? '<div class="artist-country-picker">' + boxes + "</div>"
    : '<p class="small">No roster artists yet.</p>';
  return '<fieldset class="field full" data-artist-draft><legend>Start from existing artists</legend>' +
    '<p class="small">Pick one to three roster artists or analyzed recordings. A recording adds musical traits only. You still choose the name.</p>' +
    roster +
    '<label for="artist-draft-recording-search">Search analyzed recordings</label>' +
    '<input id="artist-draft-recording-search" type="search" placeholder="Real artist or song" autocomplete="off">' +
    '<div id="artist-draft-recording-results" class="artist-draft-suggestions"></div>' +
    '<p class="small" id="artist-draft-note"></p>' +
    '<button type="button" class="secondary" id="artist-draft" data-action="artist-draft" disabled>Draft from selected artists</button></fieldset>';
}
function createDialog(genres, countries, artists) {
  const options = genres.map(genre => '<option value="' + escapeHtml(genre) + '"></option>').join("");
  const countryBoxes = countries.map(country =>
    '<label><input type="checkbox" name="countries" value="' + escapeHtml(country.code) + '"> ' + escapeHtml(country.name) + "</label>").join("");
  return '<dialog id="artist-create-dialog" aria-labelledby="artist-form-title">' +
    '<div class="dialog-header"><strong id="artist-form-title">Create artist</strong>' +
    '<button type="button" class="icon-button" data-action="artist-create-close" aria-label="Close">×</button></div>' +
    '<p class="small">Review the name yourself before publishing. Blossom does not check it.</p>' +
    '<form id="artist-form" class="fields">' +
    '<input type="hidden" id="artist-id" name="id" value="">' +
    '<div class="field"><label for="artist-name">Artist name</label><input id="artist-name" name="name" required maxlength="80" placeholder="e.g. Mira Solenne"></div>' +
    '<div class="field"><label for="artist-genre">Primary genre</label><input list="genre-options" id="artist-genre" name="genre" required maxlength="100" placeholder="Select or type, e.g. Country Pop"><datalist id="genre-options">' + options + "</datalist></div>" +
    '<div class="field"><label for="artist-language">Language</label><input id="artist-language" name="language" value="en" required placeholder="en"></div>' +
    '<div class="field"><label for="artist-voice">Voice</label><select id="artist-voice" name="voice"><option value="instrumental">Instrumental</option><option value="female">Female</option><option value="male">Male</option><option value="mixed">Mixed</option></select></div>' +
    '<fieldset class="field full"><legend>Countries</legend><div class="artist-country-picker">' + countryBoxes + "</div></fieldset>" +
    draftPicker(artists) +
    '<div class="field full"><label for="artist-dna">Artist DNA</label><textarea id="artist-dna" name="dna" rows="6" required placeholder="Tempo, instruments, vocal, arrangement and what to leave out"></textarea></div>' +
    '<label class="artist-name-review"><input type="checkbox" name="identityVerified" value="true"> I reviewed this name. It is fictional and does not copy a real artist or trademark.</label>' +
    '<div class="field full artist-form-actions"><button class="primary" id="artist-save">Create artist</button>' +
    '<button type="button" class="secondary" id="artist-edit-cancel" hidden data-action="artist-edit-cancel">Cancel</button></div></form></dialog>';
}

function photosDialog() {
  return '<dialog id="artist-photos-dialog" aria-labelledby="artist-photos-title">' +
    '<div class="dialog-header"><strong id="artist-photos-title">Photos</strong>' +
    '<button type="button" class="icon-button" data-action="artist-photos-close" aria-label="Close">×</button></div>' +
    '<p class="small" id="artist-photos-paste" contenteditable="true" tabindex="0" role="textbox" aria-label="Paste a copied PNG or JPEG to add it">Paste a copied PNG or JPEG to add it.</p>' +
    '<div id="artist-photos-body"></div></dialog>';
}

function focusDialog() {
  return '<dialog id="artist-focus-dialog" aria-labelledby="artist-focus-title">' +
    '<div class="dialog-header"><strong id="artist-focus-title">Set photo focus</strong>' +
    '<button type="button" class="icon-button" data-action="artist-focus-cancel" aria-label="Close">×</button></div>' +
    '<p class="small">Drag the photo until the face sits in the banner. Save to keep this crop.</p>' +
    '<div class="artist-focus-frame" aria-label="Drag to choose the visible part of the photo"><img alt="Crop preview for the artist banner" draggable="false"></div>' +
    '<div class="actions"><button type="button" class="primary" data-action="artist-focus-save">Save focus</button>' +
    '<button type="button" class="secondary" data-action="artist-focus-cancel">Cancel</button></div></dialog>';
}

function photoControls(artist, image) {
  const point = savedFocus(image);
  return '<div class="artist-image-option-wrap"><button type="button" class="artist-media-option' + (image.selected ? " is-active" : "") + '"' +
    ' data-action="artist-image-select" data-artist-id="' + escapeHtml(artist.id) + '" data-image-id="' + escapeHtml(image.id) + '"' +
    ' title="' + escapeHtml(image.selected ? "Active artist background" : "Use as artist background") + '"' +
    ' aria-pressed="' + (image.selected ? "true" : "false") + '" ' + (image.selected ? "disabled" : "") + ">" +
    '<img src="' + escapeHtml(image.url) + '" alt="Artist background option for ' + escapeHtml(artist.name) + '" data-photo-focus data-focus-x="' + point.focusX + '" data-focus-y="' + point.focusY + '" loading="lazy">' +
    "<span>" + escapeHtml(image.selected ? "Current background" : "Use background") + "</span></button>" +
    '<button type="button" class="secondary mini" data-action="artist-focus-open" data-artist-id="' + escapeHtml(artist.id) + '"' +
    ' data-image-id="' + escapeHtml(image.id) + '" data-image-url="' + escapeHtml(image.url) + '"' +
    ' data-focus-x="' + point.focusX + '" data-focus-y="' + point.focusY + '">Set focus</button>' +
    '<button type="button" class="secondary mini artist-image-remove" data-action="artist-image-delete"' +
    ' data-artist-id="' + escapeHtml(artist.id) + '" data-image-id="' + escapeHtml(image.id) + '"' +
    ' aria-label="Remove photo from ' + escapeHtml(artist.name) + '">Remove</button></div>';
}

export function artistPage(data) {
  const artists = data.artists || [];
  const genres = Object.values(data.genres || {}).flat();
  const countries = data.countries || [];
  const countryName = code => countries.find(country => country.code === code)?.name || code;
  const launch = '<div class="artist-create-launch"><button type="button" class="primary" data-action="artist-create-open">Create artist</button></div>' +
    createDialog(genres, countries, artists);
  const search = '<div class="artist-search"><label for="artist-search">Search artists</label>' +
    '<input id="artist-search" type="search" placeholder="Name, genre, or country" autocomplete="off"></div>';
  const roster = '<h2>Roster <span class="small" id="artist-roster-count">(' + artists.length + ")</span></h2>" +
    (artists.length ? '<div class="artist-grid artist-banner-grid">' + artists.map(artist => {
      const banner = data.artistBanners?.[artist.id];
      const images = data.artistImages?.[artist.id] || [];
      const point = savedFocus(banner);
      const id = escapeHtml(artist.id);
      return '<article class="artist-card artist-banner-card" data-artist-id="' + id + '">' +
        '<div class="artist-hero">' +
        (banner ? '<img class="artist-hero-image" src="' + escapeHtml(banner.url) + '" alt="Artist banner for ' + escapeHtml(artist.name) + '" data-photo-focus data-focus-x="' + point.focusX + '" data-focus-y="' + point.focusY + '" loading="lazy">' :
          '<div class="artist-hero-placeholder" aria-hidden="true">' + escapeHtml(artist.name.slice(0, 1)) + "</div>") +
        '<div class="artist-hero-shade" aria-hidden="true"></div>' +
        '<div class="artist-hero-content"><span class="artist-hero-eyebrow">BLOSSOM ARTIST</span>' +
        "<h3>" + escapeHtml(artist.name) + '</h3><span class="artist-hero-genre">' + escapeHtml(artist.genre) + "</span></div>" +
        '</div><div class="artist-tile-dna" tabindex="0">' +
        '<p class="artist-tile-dna-preview">' + escapeHtml(artist.dna) + "</p>" +
        '<div class="artist-tile-dna-full" aria-hidden="true">' + escapeHtml(artist.dna) + "</div>" +
        '</div><div class="artist-tile-actions">' +
        '<button type="button" class="secondary" data-action="artist-edit" data-artist-id="' + id + '">Edit artist</button>' +
        '<button type="button" class="secondary" data-action="artist-image-generate" data-artist-id="' + id + '">Generate banner</button>' +
        '<label class="secondary studio-upload">Upload banner<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" data-artist-banner="' + id + '" hidden></label>' +
        '<button type="button" class="secondary" data-action="artist-photos-open" data-artist-id="' + id + '">Manage photos</button>' +
        '</div><div class="artist-banner-details">' +
        '<div class="artist-banner-bio">' +
        '<div class="small">' + escapeHtml(artist.genre) + " · " + escapeHtml(artist.language) + " · " + escapeHtml(artist.voice) + "</div>" +
        "<p>" + escapeHtml(artist.dna) + "</p>" +
        '<div class="tagrow">' + artist.countries.map(code => '<span class="tag">' + escapeHtml(countryName(code)) + "</span>").join("") +
        '<span class="tag" title="Your own reminder that this fictional name does not copy a real artist. Blossom does not verify names.">' + (artist.identityVerified ? "Name reviewed" : "Name not reviewed") + "</span></div>" +
        '<div class="artist-card-actions"><button type="button" class="secondary" data-action="artist-edit" data-artist-id="' + id + '">Edit artist</button></div>' +
        "</div>" +
        '<div class="artist-photo-generate"><button class="primary" type="button" data-action="artist-image-generate" data-artist-id="' + id + '">✦ Generate artist banner</button>' +
        '<label class="secondary studio-upload">Upload banner<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" data-artist-banner="' + id + '" hidden></label>' +
        "<details><summary>Custom photo prompt</summary><textarea id=\"artist-photo-prompt-" + id + '" rows="2" placeholder="Optional: describe the location, clothing, light and artistic direction for a wide photo"></textarea></details></div>' +
        (images.length ?
          '<div class="artist-media-library"><div class="artist-media-heading"><strong>Artist photos</strong><span>' + images.length + " images · choose the background</span></div>" +
          '<div class="artist-media-list">' + images.map(image => photoControls(artist, image)).join("") + "</div></div>" :
          '<p class="artist-banner-hint">Generate a wide artist photo, upload a PNG or JPEG, or paste a copied image. It stays with this artist.</p>') +
        "</div></article>";
    }).join("") + "</div>" : '<div class="empty">No artists yet. Create one above or run npm run seed for eight proposed identities.</div>');
  return launch + search + roster + '<p id="artist-search-empty" hidden></p>' + focusDialog() + photosDialog();
}

export function mergeArtistDna(existing, incoming, previousDraft = "") {
  const next = String(incoming ?? "").trim();
  const current = String(existing ?? "").replace(/\s+$/, "");
  if (!next) return current.trim();
  if (!current.trim()) return next;
  const previous = String(previousDraft ?? "").trim();
  if (previous && current.endsWith(previous)) {
    const prefix = current.slice(0, current.length - previous.length).replace(/\s+$/, "");
    return prefix ? prefix + "\n\n" + next : next;
  }
  if (current === next || current.endsWith("\n\n" + next)) return current;
  return current + "\n\n" + next;
}

function rememberedDraft(form) {
  if (form.dataset && typeof form.dataset.lastArtistDraftDna === "string") return form.dataset.lastArtistDraftDna;
  return form.lastArtistDraftDna || "";
}

function rememberDraft(form, dna) {
  if (form.dataset) form.dataset.lastArtistDraftDna = dna;
  else form.lastArtistDraftDna = dna;
}

export function applyArtistDraft(form, draft) {
  if (Object.hasOwn(draft, "genre")) form.elements.genre.value = draft.genre;
  if (Object.hasOwn(draft, "language")) form.elements.language.value = draft.language;
  if (Object.hasOwn(draft, "voice")) form.elements.voice.value = draft.voice;
  const incoming = String(draft.dna ?? "");
  form.elements.dna.value = mergeArtistDna(form.elements.dna.value, incoming, rememberedDraft(form));
  rememberDraft(form, incoming.trim());
  if (Object.hasOwn(draft, "countries")) {
    for (const box of form.querySelectorAll('input[name="countries"]'))
      box.checked = (draft.countries || []).includes(box.value);
  }
}

export function draftRecordingSearchPath(query) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return "";
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", "20");
  params.set("analyzed", "1");
  params.set("prefix", "1");
  return "music-dna/search?" + params.toString();
}

export function recordingChoicesForDraft(payload, query, kept = []) {
  const result = recordingSearchChoices(payload, query);
  const seen = new Set();
  const choices = [];
  for (const item of kept || []) {
    const id = String(item?.id ?? "");
    const label = String(item?.label ?? "").trim();
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    choices.push({ id, label });
  }
  for (const choice of result.choices) {
    if (seen.has(choice.id)) continue;
    seen.add(choice.id);
    choices.push(choice);
  }
  return { choices, note: choices.length === 0 ? result.note : "" };
}

export function draftSelection(form) {
  const artistIds = [...form.querySelectorAll('input[name="draftArtist"]:checked')].map(box => box.value);
  const recordingIds = [...form.querySelectorAll('input[name="draftRecording"]:checked')].map(box => box.value);
  if (!artistIds.length && !recordingIds.length) return null;
  return { artistIds, recordingIds };
}

export function recordingSearchChoices(payload, query) {
  const needle = String(query ?? "").trim();
  const profiles = Array.isArray(payload) ? payload : payload?.results;
  const choices = [];
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile?.analysis || !profile.analysisVersion || !profile.id) continue;
    const name = String(profile.artist ?? "").trim();
    const title = String(profile.title ?? "").trim();
    if (!name || !title) continue;
    choices.push({ id: String(profile.id), label: name + " — " + title });
  }
  return { choices, note: needle && choices.length === 0 ? "No analyzed recording for that search." : "" };
}

export function recordingChoiceMarkup(choices, selectedIds = []) {
  const selected = new Set(selectedIds);
  return (choices || []).map(choice =>
    '<label><input type="checkbox" name="draftRecording" value="' + escapeHtml(choice.id) + '"' +
    (selected.has(choice.id) ? " checked" : "") + "> " + escapeHtml(choice.label) + "</label>").join("");
}

export function guardArtistDraftPick(box, boxes) {
  if ([...boxes].filter(item => item.checked).length <= 3) return "";
  box.checked = false;
  return "Choose at most three artists";
}

export function artistDraftButtonEnabled(boxes) {
  return [...boxes].some(item => item.checked);
}

export function setArtistDraftMode(form, mode) {
  const fieldset = form.querySelector("[data-artist-draft]");
  if (fieldset) fieldset.hidden = mode === "edit";
}
