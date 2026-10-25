export const DNA_STYLE_BUDGET = 700;
export const SUNO_STYLE_BUDGET = 1000;

const DISCLAIMER = /unmeasured|niet op audio|niet gemeten|not measured|unverif|inferred|brongebaseerd|no audio|youtube|recensie|source lookup/i;

function cleanTag(value, max = 80) {
  return String(value ?? "").replace(/[,]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function musicalTag(value, max = 48) {
  const clean = cleanTag(value, max + 40);
  if (!clean || clean.length > max || DISCLAIMER.test(clean)) return "";
  return clean;
}

export function hasStyleTraits(analysis) {
  if (!analysis || typeof analysis !== "object") return false;
  const genres = Array.isArray(analysis.genres) ? analysis.genres : [];
  const instruments = Array.isArray(analysis.instruments) ? analysis.instruments : [];
  return genres.some(genre => cleanTag(genre)) || instruments.some(item => cleanTag(item?.name));
}

export function tempoBand(bpm) {
  if (typeof bpm !== "number" || !Number.isFinite(bpm)) return "";
  if (bpm < 80) return "slow tempo";
  if (bpm < 100) return "mid-slow tempo";
  if (bpm < 120) return "mid-tempo";
  if (bpm < 140) return "uptempo";
  return "fast tempo";
}

function vocalTags(vocals) {
  if (!vocals || typeof vocals !== "object") return [];
  const timbre = musicalTag(vocals.timbre, 32);
  const type = musicalTag(vocals.type, 24);
  const delivery = musicalTag(vocals.delivery, 40);
  const lead = timbre ? timbre + " vocals" : (type ? type + " vocals" : "");
  return [lead, delivery].filter(Boolean);
}

function instrumentTag(instrument) {
  if (!instrument || typeof instrument !== "object") return musicalTag(instrument);
  const name = musicalTag(instrument.name, 40);
  const timbre = musicalTag(instrument.timbre, 32);
  if (timbre && name) {
    const both = cleanTag(timbre + " " + name, 48);
    return both.length <= 48 && !DISCLAIMER.test(both) ? both : name;
  }
  return name || timbre;
}

function primaryCandidates(traits) {
  const genres = (traits.genres || []).map(genre => musicalTag(genre, 40)).filter(Boolean).slice(0, 2);
  const mood = musicalTag((traits.moods || [])[0], 40);
  const instruments = (traits.instruments || []).map(instrumentTag).filter(Boolean).slice(0, 4);
  const texture = musicalTag(traits.production?.texture, 60);
  return [...genres, tempoBand(traits.bpm), ...vocalTags(traits.vocals), ...instruments, texture, mood].filter(Boolean);
}

function secondaryCandidates(traits) {
  return [
    musicalTag((traits.genres || [])[0], 40),
    musicalTag((traits.moods || [])[0], 40),
    instrumentTag((traits.instruments || [])[0]),
    musicalTag(traits.production?.texture, 60)
  ].filter(Boolean);
}

function takeTags(candidates, budget, used, maxCount) {
  const tags = [];
  let usedChars = 0;
  for (const candidate of candidates) {
    if (tags.length >= maxCount) break;
    const key = candidate.toLowerCase();
    if (used.has(key)) continue;
    const extra = (tags.length ? 2 : 0) + candidate.length;
    if (usedChars + extra > budget) continue;
    tags.push(candidate);
    used.add(key);
    usedChars += extra;
  }
  return tags;
}

function arrangementFrom(traits) {
  return (traits.structure || []).slice(0, 8).map(section => {
    const label = cleanTag(section?.label, 40);
    const bits = [...(section?.instruments || []), ...(section?.techniques || [])]
      .map(item => cleanTag(item, 40)).filter(Boolean);
    const unique = [];
    for (const bit of bits) {
      if (unique.some(item => item.toLowerCase() === bit.toLowerCase())) continue;
      unique.push(bit);
      if (unique.length === 3) break;
    }
    const direction = unique.join(", ").slice(0, 80);
    return label && direction ? { label, direction } : null;
  }).filter(Boolean);
}

export function annotateLyrics(lyrics, arrangement) {
  const text = String(lyrics || "");
  if (!text || !arrangement?.length) return text;
  const byLabel = new Map();
  for (const item of arrangement) {
    const label = cleanTag(item.label, 40).toLowerCase();
    const direction = String(item.direction || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (label && direction && !byLabel.has(label)) byLabel.set(label, direction);
  }
  return text.replace(/\[([^\]\n]+)\]/g, (whole, inner) => {
    const raw = inner.trim();
    const name = raw.split(":")[0].trim();
    const direction = byLabel.get(name.toLowerCase());
    if (!direction || raw.includes(":")) return whole;
    return "[" + name + ": " + direction + "]";
  });
}

export function dnaSunoPlan(items) {
  const usable = [];
  const skipped = [];
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    if (!hasStyleTraits(item)) {
      if (item.referenceId) skipped.push({ profileId: item.referenceId, reason: "no style traits" });
      return;
    }
    const weight = Number.isInteger(item.weight) && item.weight >= 1 && item.weight <= 100 ? item.weight : 50;
    usable.push({ item, index, weight });
  });
  usable.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const total = usable.reduce((sum, row) => sum + row.weight, 0) || 1;
  const used = new Set();
  let remaining = DNA_STYLE_BUDGET;
  const contributions = usable.map((row, ordinal) => {
    const last = ordinal === usable.length - 1;
    const share = row.weight / total;
    const reserve = last ? 0 : 24 * (usable.length - ordinal - 1);
    let budget = last ? remaining : Math.min(remaining - reserve, Math.max(24, Math.round(DNA_STYLE_BUDGET * share)));
    if (budget < 0) budget = 0;
    remaining -= budget;
    const primary = ordinal === 0;
    const maxCount = primary ? 12 : (share >= 0.4 ? 3 : share > 0.25 ? 2 : 1);
    const tags = takeTags(
      primary ? primaryCandidates(row.item) : secondaryCandidates(row.item),
      budget, used, maxCount
    );
    return { profileId: row.item.referenceId || "", weight: row.weight, share: Math.round(share * 100), tags };
  }).filter(item => item.tags.length);
  const style = contributions.flatMap(item => item.tags).join(", ").slice(0, DNA_STYLE_BUDGET);
  return {
    style, characters: style.length, budget: DNA_STYLE_BUDGET, contributions, skipped,
    arrangement: usable[0] ? arrangementFrom(usable[0].item) : []
  };
}

export function composeSunoStyle(parameters, resultStyle, dnaStyle) {
  const p = parameters || {};
  const dna = String(dnaStyle || "").trim();
  if (!dna) {
    return [p.genre, ...p.additionalStyles, resultStyle || "", p.customInstructions].filter(Boolean).join(", ");
  }
  const head = dna.slice(0, DNA_STYLE_BUDGET);
  const own = [p.genre, ...(p.additionalStyles || []), p.customInstructions].filter(Boolean);
  let room = SUNO_STYLE_BUDGET - head.length - 2;
  const tail = [];
  for (const part of own) {
    const text = String(part);
    if (!text || room <= 0) break;
    const sep = tail.length ? 2 : 0;
    if (text.length + sep <= room) {
      tail.push(text);
      room -= text.length + sep;
    } else {
      const cut = text.slice(0, Math.max(0, room - sep)).trim();
      if (cut) tail.push(cut);
      break;
    }
  }
  return [head, ...tail].filter(Boolean).join(", ").slice(0, SUNO_STYLE_BUDGET);
}
