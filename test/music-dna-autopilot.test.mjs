import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MusicDnaAutopilot } from "../src/music-dna-autopilot.mjs";
import { autopilotStatusMarkup, musicDnaView } from "../public/music-dna.js";

const ONE = "11111111-1111-4111-8111-111111111111";
const TWO = "22222222-2222-4222-8222-222222222222";
function dna() {
  return { get(id) {
    if (![ONE, TWO].includes(id)) throw Error("Recording not found");
    return { id, title: id === ONE ? "Radio Edit" : "Original Mix",
      artist: "Test Artist", releaseYear: 1991, analysis: { durationMs: 234000 } };
  }};
}

test("Autopilot refuses downloads without explicit per-request rights acknowledgement", () => {
  const queue = new MusicDnaAutopilot(dna(), { analyzerDir: "/definitely/missing" });
  assert.throws(() => queue.enqueue([ONE], false), /permission/i);
  assert.throws(() => queue.enqueue([ONE, "bad"], true), /valid Music DNA/i);
  assert.throws(() => queue.enqueue(new Array(51).fill(ONE), true), /1–50/);
  assert.throws(() => queue.enqueue([ONE, "33333333-3333-4333-8333-333333333333"], true), /not found/);
  assert.deepEqual(queue.status().jobs, []);
});

test("Autopilot reports missing analyzer instead of pretending audio was measured", async () => {
  const queue = new MusicDnaAutopilot(dna(), { analyzerDir: "/definitely/missing" });
  const result = queue.enqueue([ONE], true);
  assert.equal(result.queued, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.status().jobs[0].status, "failed");
  assert.match(queue.status().jobs[0].message, /Install the Blossom Autopilot/);
});

test("Autopilot runs selected UUIDs with a fixed local endpoint, without forwarding explicit tokens", async t => {
  const tmp = mkdtempSync(join(tmpdir(), "blossom-autopilot-"));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  mkdirSync(join(tmp, "analyzer/.venv/bin"), { recursive: true });
  writeFileSync(join(tmp, "analyzer/.venv/bin/python"), "");
  writeFileSync(join(tmp, "analyzer/blossom_bridge.py"), "");
  writeFileSync(join(tmp, "runner.py"), "");
  const invocations = [];
  function fakeSpawn(executable, args, opts) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { on() {}, end(payload) {
      invocations.push({ executable, args, opts, payload: JSON.parse(payload) });
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from('AUTOPILOT_RESULT={"status":"published","message":"Saved DNA"}\n'));
        child.emit("close", 0);
      });
    }};
    return child;
  }
  const originalToken = process.env.BLOSSOM_MCP_TOKEN;
  process.env.BLOSSOM_MCP_TOKEN = "do-not-forward-to-child";
  t.after(() => {
    if (originalToken === undefined) delete process.env.BLOSSOM_MCP_TOKEN;
    else process.env.BLOSSOM_MCP_TOKEN = originalToken;
  });
  const queue = new MusicDnaAutopilot(dna(), { analyzerDir: join(tmp, "analyzer"),
    runner: join(tmp, "runner.py"), processSpawn: fakeSpawn });
  const result = queue.enqueue([ONE, TWO, ONE], true);
  assert.equal(result.queued, 2);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations.map(x => x.payload.id), [ONE, TWO]);
  assert.ok(invocations.every(x => x.opts.env.BLOSSOM_MCP_URL === "http://127.0.0.1:8787/mcp"));
  assert.ok(invocations.every(x => !Object.hasOwn(x.opts.env, "BLOSSOM_MCP_TOKEN")));
  assert.deepEqual(queue.status().jobs.map(job => job.status), ["published", "published"]);
});

test("Autopilot job status escapes untrusted content and action controls render for selection", () => {
  const html = autopilotStatusMarkup([{
    artist: "<script>alert(1)</script>", title: "Single",
    status: "held_low_confidence", message: '<img src=x onerror="fail()">'
  }]);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /held_low_confidence/);
  const page = musicDnaView({ data: {
    musicDnaProfiles: [{ id: ONE, artist: "Test Artist", title: "Single" }],
    musicDnaTotal: 1, musicDnaSelected: { id: ONE, artist: "Test Artist", title: "Single" }
  } });
  assert.match(page, /data-action="dna-autopilot-toggle"/);
  assert.match(page, /data-action="dna-autopilot-one"/);
  assert.match(page, /data-action="dna-autopilot-selected"/);
});
