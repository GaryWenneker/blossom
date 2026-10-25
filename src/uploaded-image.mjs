import { DomainError } from "./domain.mjs";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function inspectUploadedImage(data, { square = false } = {}) {
  if (!Buffer.isBuffer(data) || data.length < 16)
    throw new DomainError("Upload a PNG, JPEG, or WebP image", 400);
  const image = sniff(data);
  if (!image) throw new DomainError("Upload a PNG, JPEG, or WebP image", 400);
  if (image.width < 1 || image.height < 1 || image.width > 12000 || image.height > 12000)
    throw new DomainError("Image dimensions must be between 1 and 12000 pixels", 400);
  if (square && image.width !== image.height)
    throw new DomainError("Cover must be square artwork, at most 12000×12000 pixels", 400);
  return image;
}

function sniff(data) {
  if (data.subarray(0, 8).equals(PNG) && data.length >= 24 && data.subarray(12, 16).toString() === "IHDR")
    return { mime: "image/png", extension: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data[0] === 0xff && data[1] === 0xd8) return jpeg(data);
  if (data.length >= 12 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP")
    return webp(data);
  return null;
}

function jpeg(data) {
  let i = 2;
  while (i + 1 < data.length) {
    if (data[i] !== 0xff) return null;
    while (i < data.length && data[i] === 0xff) i += 1;
    if (i >= data.length) return null;
    const marker = data[i];
    i += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 1 >= data.length) return null;
    const length = data.readUInt16BE(i);
    if (length < 2 || i + length > data.length) return null;
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (length < 7) return null;
      return { mime: "image/jpeg", extension: "jpg", width: data.readUInt16BE(i + 5), height: data.readUInt16BE(i + 3) };
    }
    i += length;
  }
  return null;
}

function webp(data) {
  const chunk = data.subarray(12, 16).toString();
  if (chunk === "VP8X" && data.length >= 30) {
    return { mime: "image/webp", extension: "webp",
      width: 1 + (data[24] | (data[25] << 8) | (data[26] << 16)),
      height: 1 + (data[27] | (data[28] << 8) | (data[29] << 16)) };
  }
  if (chunk === "VP8 " && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a)
    return { mime: "image/webp", extension: "webp",
      width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { mime: "image/webp", extension: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
