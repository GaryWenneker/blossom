export const SUNO_STYLE_LIMIT = 1000;

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function splitClauses(text) {
  return normalize(text).split(/(?<=[.!?])\s+|,\s+/).map(normalize).filter(Boolean);
}

function sameClause(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function alreadyPacked(pieces, clause) {
  if (pieces.some(piece => sameClause(piece, clause))) return true;
  return clause.length >= 16 && pieces.join(", ").toLowerCase().includes(clause.toLowerCase());
}

export function compactClause(clause, max, keep = "head") {
  const text = normalize(clause);
  if (text.length <= max) return text;
  if (keep === "ends" && max >= 16) {
    const tail = Math.min(Math.floor(max * 0.45), text.length);
    const head = max - tail - 3;
    if (head >= 8) return text.slice(0, head) + "..." + text.slice(text.length - tail);
  }
  const words = text.split(" ");
  let out = "";
  for (const word of words) {
    const next = out ? out + " " + word : word;
    if (next.length > max) break;
    out = next;
  }
  return out || text.slice(0, max);
}

function briefReference(body, weight) {
  const moods = [];
  const details = [];
  let bpm = "";
  let production = "";
  for (const clause of splitClauses(body)) {
    if (/phrasing$/i.test(clause)) continue;
    if (/\bBPM\b/i.test(clause) && !bpm) bpm = compactClause(clause, 48);
    else if (/mood$/i.test(clause)) moods.push(clause);
    else if (/production$/i.test(clause) && !production) production = compactClause(clause, 64);
    else details.push(compactClause(clause, 48));
  }
  const picked = [];
  if (weight) picked.push("(inspiration weight " + weight + "/100)");
  const [primary, ...rest] = details;
  if (primary) picked.push(primary);
  const instruments = rest.filter(clause => clause.split(" ").length > 3);
  picked.push(...instruments.slice(0, 3), ...moods.slice(0, 1));
  if (bpm) picked.push(bpm);
  if (production) picked.push(production);
  return compactClause(picked.join(", "), 230, "head");
}

function inspirationBriefs(text) {
  const source = normalize(text);
  const references = [];
  const marker = /\(inspiration weight (\d+)\/100\)/g;
  let match;
  let end = 0;
  while ((match = marker.exec(source))) {
    references.push({ body: source.slice(end, match.index), weight: match[1] });
    end = marker.lastIndex;
  }
  const tail = source.slice(end);
  if (normalize(tail)) references.push({ body: tail, weight: "" });
  return references.map(reference => briefReference(reference.body, reference.weight)).filter(Boolean);
}

function originalStyle(fields) {
  return [fields.genre, fields.artistDna, ...(fields.additionalStyles || []), fields.resultStyle, fields.referenceStyles, fields.customInstructions]
    .map(normalize)
    .filter(Boolean)
    .join(", ");
}

function place(pieces, clause, keep) {
  const next = normalize(clause);
  if (!next || alreadyPacked(pieces, next)) return;
  if (pieces.concat(next).join(", ").length <= SUNO_STYLE_LIMIT) {
    pieces.push(next);
    return;
  }
  const room = SUNO_STYLE_LIMIT - pieces.join(", ").length - (pieces.length ? 2 : 0);
  const shorter = room >= 12 ? compactClause(next, room, keep) : "";
  if (shorter && !alreadyPacked(pieces, shorter) && pieces.concat(shorter).join(", ").length <= SUNO_STYLE_LIMIT)
    pieces.push(shorter);
}

function placeAll(pieces, clauses, keep) {
  for (const clause of clauses) place(pieces, clause, keep);
}

export function packSunoStyle(fields, limit = SUNO_STYLE_LIMIT) {
  if (limit !== SUNO_STYLE_LIMIT) throw new Error("Suno style packing uses the fixed 1000 character field");
  const original = originalStyle(fields);
  if (original.length <= SUNO_STYLE_LIMIT) return original;

  const pieces = [];
  placeAll(pieces, [fields.genre, ...(fields.additionalStyles || [])], "head");
  const instructions = splitClauses(fields.customInstructions);
  const correctionCount = Math.min(3, instructions.length);
  placeAll(pieces, instructions.slice(-correctionCount).reverse(), "ends");
  placeAll(pieces, inspirationBriefs(fields.referenceStyles), "head");
  placeAll(pieces, instructions.slice(0, instructions.length - correctionCount), "ends");
  placeAll(pieces, splitClauses(fields.artistDna).map(clause => compactClause(clause, 90)), "head");
  placeAll(pieces, splitClauses(fields.resultStyle).map(clause => compactClause(clause, 90)), "head");
  return pieces.join(", ");
}
