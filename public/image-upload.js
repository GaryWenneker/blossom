const MAX_UPLOAD_IMAGE_BYTES = 12 * 1024 * 1024;

export function imageMime(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/pjpeg" || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return "";
}

export async function uploadImageFile(file, url) {
  if (!file) throw Error("Choose an image file");
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) throw Error("Image must be at most 12MB");
  const mime = imageMime(file);
  if (!mime) throw Error("Upload a PNG or JPEG image");
  const response = await fetch(url, {
    method: "POST",
    headers: { "x-blossom-request": "ui", "content-type": mime },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "Image upload failed");
  return data;
}

export function uploadMessage(kind, data) {
  if (kind === "artist-photo")
    return data?.selected ? "Artist banner uploaded and shown" : "Artist banner uploaded. Choose it in the photo gallery to show it.";
  if (kind === "track-art") return "Track art uploaded";
  return "Album art uploaded";
}

function clipboardFiles(clipboard) {
  const files = [];
  if (clipboard?.files) {
    for (const file of clipboard.files) files.push(file);
  }
  for (const item of clipboard?.items || []) {
    const type = String(item?.type || "");
    const readable = item?.kind === "file" || type.startsWith("image/");
    if (readable && typeof item.getAsFile === "function") {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

function isClipboardImageCandidate(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  if (type.startsWith("image/") || imageMime(file)) return true;
  return (type === "" || type === "application/octet-stream") && Number(file.size) > 0;
}

export function imageFileFromClipboard(clipboard) {
  return clipboardFiles(clipboard).find(isClipboardImageCandidate) || null;
}

export async function namedImageFile(file) {
  if (!file) return null;
  if (imageMime(file)) return file;
  if (typeof file.slice !== "function") return null;
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) return null;
  const type = png ? "image/png" : "image/jpeg";
  const name = png ? "pasted.png" : "pasted.jpg";
  const source = file instanceof Blob ? file : bytes;
  return new File([source], name, { type });
}

export async function imageFileFromClipboardItems(items) {
  for (const item of items || []) {
    const type = (item?.types || []).find(entry => entry === "image/png" || entry === "image/jpeg" || entry === "image/jpg");
    if (!type || typeof item.getType !== "function") continue;
    const mime = type === "image/jpg" ? "image/jpeg" : type;
    const blob = await item.getType(type);
    return new File([blob], mime === "image/png" ? "pasted.png" : "pasted.jpg", { type: mime });
  }
  return null;
}

export function imagePasteShortcut(event) {
  const key = String(event?.key || "").toLowerCase();
  return key === "v" && !!(event?.metaKey || event?.ctrlKey) && !event?.altKey && !event?.shiftKey && !event?.isComposing;
}

export function typingTarget(target) {
  const tag = String(target?.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target?.isContentEditable && target?.id !== "artist-photos-paste") return true;
  return false;
}

export function bannerPasteDestination({
  photosArtistId = "", focusedArtistId = "", soleArtistId = "", projectId = "", projectArtistId = ""
} = {}) {
  const artistId = String(photosArtistId || focusedArtistId || soleArtistId || "");
  if (artistId) return { kind: "artist-photo", url: "/api/studio/artists/" + artistId + "/upload-banner" };
  if (projectId && projectArtistId) {
    return { kind: "artist-photo", url: "/api/studio/projects/" + projectId + "/upload-image/artist-photo" };
  }
  return null;
}

export async function acceptPastedImage(source, context, upload) {
  const candidate = isClipboardImageCandidate(source) ? source : imageFileFromClipboard(source);
  const file = await namedImageFile(candidate);
  if (!file) return { handled: false };
  const destination = bannerPasteDestination(context);
  if (!destination) return { handled: true, missingTarget: true };
  return { handled: true, kind: destination.kind, data: await upload(file, destination.url) };
}
