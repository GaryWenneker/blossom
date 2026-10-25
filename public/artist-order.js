const escapeAttr = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

export function moveItem(ids, fromId, toId) {
  const next = [...ids];
  const from = next.indexOf(fromId);
  const to = next.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function dragHandleMarkup(name) {
  return '<span class="artist-tile-handle" draggable="true" aria-label="Drag to reorder ' +
    escapeAttr(name) + '" title="Drag to reorder"><span aria-hidden="true">⋮⋮</span></span>';
}

export function bindArtistRoster(state, api, refresh, message, doc = document) {
  let dragged = "";
  const cards = () => [...doc.querySelectorAll(".artist-banner-card")];
  const clearDrag = () => cards().forEach(card => card.classList.remove("is-dragging", "is-drop-target"));
  doc.addEventListener("dragstart", event => {
    const handle = event.target.closest?.(".artist-tile-handle");
    if (!handle) return;
    const card = handle.closest(".artist-banner-card");
    if (!card) return;
    dragged = card.dataset.artistId;
    event.dataTransfer.setData("text/plain", dragged);
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("is-dragging");
  });
  doc.addEventListener("dragover", event => {
    const card = event.target.closest?.(".artist-banner-card");
    if (!card || !dragged) return;
    event.preventDefault();
    cards().forEach(item => item.classList.remove("is-drop-target"));
    if (card.dataset.artistId !== dragged) card.classList.add("is-drop-target");
  });
  doc.addEventListener("drop", async event => {
    const card = event.target.closest?.(".artist-banner-card");
    if (!card || !dragged) return;
    event.preventDefault();
    const fromId = dragged;
    dragged = "";
    clearDrag();
    const ids = state.data.artists.map(item => item.id);
    const next = moveItem(ids, fromId, card.dataset.artistId);
    if (next.every((id, index) => id === ids[index])) return;
    const query = doc.getElementById("artist-search")?.value || "";
    try {
      await api("artists/order", { ids: next });
      await refresh();
      const input = doc.getElementById("artist-search");
      if (input && query) {
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch (error) {
      message(error.message, true);
    }
  });
  doc.addEventListener("dragend", () => { dragged = ""; clearDrag(); });
}
