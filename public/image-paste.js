const ACCEPTED = new Set(["image/png", "image/jpeg", "image/webp"]);

export function clipboardImage(data) {
  const files = [];
  if (data?.files) files.push(...data.files);
  if (data?.items) {
    for (const item of data.items) {
      if (item?.kind !== "file") continue;
      const file = item.getAsFile?.();
      if (file) files.push(file);
    }
  }
  return files.find(file => ACCEPTED.has(file?.type === "image/jpg" ? "image/jpeg" : file?.type)) || null;
}

export async function postImage(path, file) {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  const response = await fetch("/api/" + path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": type, "X-Blossom-Request": "ui" },
    body: file
  });
  const body = await response.json().catch(() => ({ error: "Unexpected server response" }));
  if (response.status === 401) {
    window.location.assign("/login");
    throw Error("Session expired");
  }
  if (!response.ok) throw Error(body.error || "Upload failed");
  return body;
}
