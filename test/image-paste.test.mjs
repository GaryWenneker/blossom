import test from "node:test";
import assert from "node:assert/strict";
import { artistPage } from "../public/artists.js";
import {
  acceptPastedImage, bannerPasteDestination, imageFileFromClipboard, imageFileFromClipboardItems,
  imagePasteShortcut, typingTarget
} from "../public/image-upload.js";

const png = { type: "image/png", name: "copied.png", size: 32 };
const jpeg = { type: "image/jpeg", name: "", size: 40 };
const pngBytes = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("the photo dialog says a copied image can be pasted", () => {
  const html = artistPage({ artists: [], genres: {}, countries: [] });
  assert.match(html, /Paste a copied PNG or JPEG to add it/);
});

test("a copied PNG on the clipboard is the image to paste", () => {
  const file = imageFileFromClipboard({ files: [png], items: [] });
  assert.equal(file, png);
});

test("a copied JPEG from a clipboard item is the image to paste", () => {
  const file = imageFileFromClipboard({
    files: [],
    items: [{ kind: "file", getAsFile: () => jpeg }]
  });
  assert.equal(file, jpeg);
});

test("pasted text is not an image", () => {
  assert.equal(imageFileFromClipboard({
    files: [],
    items: [{ kind: "string", type: "text/plain", getAsFile: () => null }]
  }), null);
});

test("an open artist photo dialog receives the pasted banner", () => {
  assert.deepEqual(bannerPasteDestination({
    photosArtistId: "artist-1",
    projectId: "project-9",
    projectArtistId: "artist-2"
  }), {
    kind: "artist-photo",
    url: "/api/studio/artists/artist-1/upload-banner"
  });
});

test("a focused artist card receives the paste when the dialog is closed", () => {
  assert.equal(bannerPasteDestination({ focusedArtistId: "artist-4" }).url,
    "/api/studio/artists/artist-4/upload-banner");
});

test("the only visible artist receives the paste", () => {
  assert.equal(bannerPasteDestination({ soleArtistId: "artist-5" }).url,
    "/api/studio/artists/artist-5/upload-banner");
});

test("a Studio project with an artist receives the pasted banner", () => {
  assert.deepEqual(bannerPasteDestination({ projectId: "project-3", projectArtistId: "artist-8" }), {
    kind: "artist-photo",
    url: "/api/studio/projects/project-3/upload-image/artist-photo"
  });
});

test("a Studio project without an artist has nowhere to paste", () => {
  assert.equal(bannerPasteDestination({ projectId: "project-3", projectArtistId: "" }), null);
});

test("accepting a pasted image uploads it to the chosen banner", async () => {
  const calls = [];
  const result = await acceptPastedImage(
    { files: [png], items: [] },
    { photosArtistId: "artist-1" },
    async (file, url) => {
      calls.push({ file, url });
      return { selected: true };
    }
  );
  assert.equal(result.handled, true);
  assert.equal(result.missingTarget, undefined);
  assert.deepEqual(calls, [{ file: png, url: "/api/studio/artists/artist-1/upload-banner" }]);
  assert.equal(result.data.selected, true);
});

test("a pasted image with no open artist is reported and not uploaded", async () => {
  let called = false;
  const result = await acceptPastedImage({ files: [png], items: [] }, {}, async () => { called = true; });
  assert.equal(result.handled, true);
  assert.equal(result.missingTarget, true);
  assert.equal(called, false);
});

test("a clipboard image is read once and uploaded without asking the clipboard again", async () => {
  const once = { type: "", name: "", size: 8, slice: () => ({ arrayBuffer: async () => pngBytes().buffer }) };
  const calls = [];
  const result = await acceptPastedImage(once, { photosArtistId: "artist-1" }, async (file, url) => {
    calls.push({ type: file.type, name: file.name, url });
    return { selected: false, id: "image-2" };
  });
  assert.equal(result.handled, true);
  assert.equal(calls[0].type, "image/png");
  assert.equal(calls[0].name, "pasted.png");
  assert.equal(calls[0].url, "/api/studio/artists/artist-1/upload-banner");
});

test("a ClipboardItem image becomes a named PNG file", async () => {
  const file = await imageFileFromClipboardItems([{
    types: ["text/plain", "image/png"],
    getType: async type => type === "image/png" ? new Blob([pngBytes()], { type }) : new Blob()
  }]);
  assert.equal(file.type, "image/png");
  assert.equal(file.name, "pasted.png");
  assert.equal(file.size, pngBytes().length);
});

test("a ClipboardItem without an image is ignored", async () => {
  assert.equal(await imageFileFromClipboardItems([{ types: ["text/plain"], getType: async () => new Blob(["hello"]) }]), null);
});

test("paste shortcut reads the clipboard unless the user is typing", () => {
  assert.equal(imagePasteShortcut({ key: "v", metaKey: true }), true);
  assert.equal(imagePasteShortcut({ key: "v", ctrlKey: true }), true);
  assert.equal(imagePasteShortcut({ key: "v", metaKey: true, shiftKey: true }), false);
  assert.equal(imagePasteShortcut({ key: "c", metaKey: true }), false);
  assert.equal(typingTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(typingTarget({ tagName: "BUTTON" }), false);
  assert.equal(typingTarget({ tagName: "P", id: "artist-photos-paste", isContentEditable: true }), false);
  assert.equal(typingTarget({ tagName: "DIV", isContentEditable: true }), true);
});

test("pasted text is left for the existing text paste handler", async () => {
  const result = await acceptPastedImage({ files: [], items: [] }, { photosArtistId: "artist-1" }, async () => {
    throw new Error("upload should not run");
  });
  assert.deepEqual(result, { handled: false });
});
