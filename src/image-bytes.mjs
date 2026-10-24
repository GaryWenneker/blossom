import { DomainError } from "./domain.mjs";

export const MAX_UPLOAD_IMAGE_BYTES = 12 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function validateUploadedImage(bytes, mime) {
  const type = String(mime || "").split(";")[0].trim().toLowerCase();
  if (!Buffer.isBuffer(bytes) || bytes.length < 24)
    throw new DomainError("Image is too small", 400);
  if (bytes.length > MAX_UPLOAD_IMAGE_BYTES)
    throw new DomainError("Image exceeds 12MB", 413);
  const png = bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.toString("ascii", 12, 16) === "IHDR";
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") {
    if (!png) throw new DomainError("Image contents do not match image/png", 400);
    return { mime: "image/png", extension: "png" };
  }
  if (type === "image/jpeg") {
    if (!jpeg || png) throw new DomainError("Image contents do not match image/jpeg", 400);
    return { mime: "image/jpeg", extension: "jpg" };
  }
  throw new DomainError("Upload a PNG or JPEG image", 415);
}
