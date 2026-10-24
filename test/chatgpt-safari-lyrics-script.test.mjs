import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/chatgpt-safari-lyrics.applescript", import.meta.url));

function appleString(source, start) {
  assert.equal(source[start], '"');
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      value += source[index + 1];
      index += 1;
      continue;
    }
    if (char === '"') return { value, next: index + 1 };
    value += char;
  }
  throw new Error("Unclosed AppleScript string");
}

function javascriptPieces(source, variable) {
  const marker = `set ${variable} to `;
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, marker);
  const first = appleString(source, at + marker.length);
  const join = " & promptLiteral & ";
  assert.equal(source.slice(first.next, first.next + join.length), join);
  const second = appleString(source, first.next + join.length);
  return [first.value, second.value];
}

function compiled(source, variable, prompt) {
  const [prefix, suffix] = variable === "fillJS"
    ? javascriptPieces(source, variable)
    : [appleString(source, source.indexOf(`set ${variable} to `) + `set ${variable} to `.length).value, ""];
  const javascript = variable === "fillJS" ? prefix + JSON.stringify(prompt) + suffix : prefix;
  return new Script(javascript);
}

test("Safari lyrics JavaScript is valid for a prompt that contains quotes and new lines", async () => {
  const source = await readFile(scriptPath, "utf8");
  const prompt = "De prins zei: \"het is 'klaar'.\"\nTweede alinea.";
  assert.doesNotThrow(() => compiled(source, "fillJS", prompt));
  assert.doesNotThrow(() => compiled(source, "readJS", prompt));
});

test("Safari lyrics results are copied onto the script so a missing JavaScript result cannot erase them", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /tell me to set actionStatus to/);
  assert.match(source, /tell me to set replyText to/);
  assert.match(source, /errorNumber is 8/);
});

test("Safari lyrics script reports phases and reads a finished brief from any ChatGPT tab", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.match(source, /count of argv\) is not 3/);
  assert.match(source, /my writeProgress\(progressPath, "20"\)/);
  assert.match(source, /my writeProgress\(progressPath, pct as text\)/);
  const readJS = appleString(source, source.indexOf("set readJS to ") + "set readJS to ".length).value;
  assert.match(readJS, /lyrics/);
  assert.match(readJS, /main \.markdown/);
  assert.match(source, /resultText is not "WAIT" then/);
  const fillAt = source.indexOf("set submitted to false");
  assert.match(source.slice(0, fillAt), /do JavaScript readJS in openDocument/);
});

test("the send button is pressed only after the prompt is already in the composer", async () => {
  const source = await readFile(scriptPath, "utf8");
  const prompt = "You are Blossom's original music editor.\n\nWrite the song.";
  const fill = compiled(source, "fillJS", prompt);
  let value = "";
  let clicks = 0;
  const button = {
    disabled: true,
    getAttribute() { return null; },
    click() { clicks += 1; }
  };
  const box = {
    tagName: "DIV",
    get innerText() { return value; },
    focus() {},
    dispatchEvent() {}
  };
  const document = {
    querySelector(selector) {
      if (selector.includes("button")) return button;
      return box;
    },
    execCommand() {
      value = prompt;
      button.disabled = true;
      return true;
    }
  };
  const run = () => fill.runInNewContext({ document, String, Event: function Event() {} });
  assert.equal(run(), "WAIT");
  assert.equal(clicks, 0);
  button.disabled = false;
  assert.equal(run(), "SUBMITTED");
  assert.equal(clicks, 1);
  assert.equal(value, prompt);
});

test("Safari lyrics script re-finds the ChatGPT tab instead of reusing the untitled document", async () => {
  const source = await readFile(scriptPath, "utf8");
  assert.doesNotMatch(source, /in chatDocument/);
  assert.doesNotMatch(source, /URL of chatDocument/);
  assert.match(source, /https:\/\/chatgpt\.com\?/);
  assert.match(source, /do JavaScript fillJS in openDocument/);
  assert.match(source, /do JavaScript readJS in openDocument/);
  assert.match(source, /blossom-role/);
  assert.match(source, /roleText is "DNA"/);
});
