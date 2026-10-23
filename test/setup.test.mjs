import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, lstat, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  nodeSupported, parseEnv, missingSettings, validateSettings,
  configureEnv, makeTestWave, launchPlist, xmlEscape
} from "../scripts/setup-blossom.mjs";

test("Node version requirement enforces >=22.13.0", () => {
  assert.equal(nodeSupported("22.12.9"), false);
  assert.equal(nodeSupported("22.13.0"), true);
  assert.equal(nodeSupported("24.0.0"), true);
  assert.equal(nodeSupported("20.19.0"), false);
});

test("Setup credentials are secure and do not overwrite existing secrets on rerun", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-setup-test-"));
  const path = join(dir, ".env");
  try {
    const first = await configureEnv(path);
    assert.equal(first.generatedPassword, true);
    const initial = await readFile(path, "utf8");
    const parsed = parseEnv(initial);
    assert.equal(Buffer.from(parsed.BLOSSOM_VAULT_KEY, "base64").length, 32);
    assert.notEqual(parsed.BLOSSOM_MCP_READ_TOKEN, parsed.BLOSSOM_MCP_WRITE_TOKEN);
    assert.equal(parsed.BLOSSOM_HOST, "127.0.0.1");
    validateSettings(parsed);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    const second = await configureEnv(path);
    assert.equal(second.generatedPassword, false);
    assert.deepEqual(second.generatedKeys, []);
    assert.equal(await readFile(path, "utf8"), initial);
    await configureEnv(path, { create: false });
    assert.throws(() => validateSettings({ ...parsed, BLOSSOM_ADMIN_PASSWORD: "short" }), /12/);
    assert.throws(() => validateSettings({ ...parsed, BLOSSOM_VAULT_KEY: "not-base64" }), /base64/);
    assert.throws(() => validateSettings({ ...parsed, BLOSSOM_MCP_WRITE_TOKEN: parsed.BLOSSOM_MCP_READ_TOKEN }), /not be equal/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Setup never follows an untrusted .env symlink and does not modify check-only configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blossom-setup-links-"));
  try {
    const target = join(dir, "target"), link = join(dir, ".env");
    await writeFile(target, "SAFE=original\n");
    await symlink(target, link);
    await assert.rejects(configureEnv(link), /unsafe .env/);
    assert.equal(await readFile(target, "utf8"), "SAFE=original\n");
    await rm(link);
    await assert.rejects(configureEnv(link, { create: false }), /does not exist/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Setup WAV is valid PCM with exact duration and measurements should be based on real decoding", () => {
  const b = makeTestWave();
  assert.equal(b.length, 16044);
  assert.equal(b.toString("ascii", 0, 4), "RIFF");
  assert.equal(b.toString("ascii", 8, 12), "WAVE");
  assert.equal(b.readUInt32LE(24), 8000);
  assert.equal(b.readUInt32LE(40), 16000);
});

test("Launch agent keeps tokens out of plist and escapes XML metacharacters", () => {
  const xml = launchPlist({
    label: "io.wenneker.blossom.server", nodePath: "/opt/homebrew/node",
    root: "/Users/example/music & data", envPath: "/Users/example/music & data/.env",
    logPath: "/Users/example/logs/blossom.log", searchPath: "/usr/bin:/bin"
  });
  assert.match(xml, /music &amp; data/);
  assert.match(xml, /--env-file=/);
  assert.match(xml, /RunAtLoad/);
  assert.match(xml, /KeepAlive/);
  assert.doesNotMatch(xml, /ADMIN_PASSWORD|MCP_WRITE_TOKEN|VAULT_KEY/);
  assert.equal(xmlEscape("<&'>"), "&lt;&amp;&apos;&gt;");
});

test("Environment parser preserves pre-existing values and defaults fill only missing keys", () => {
  const current = parseEnv("BLOSSOM_ADMIN_PASSWORD='long-enough-secret'\n# Comment\nBLOSSOM_PORT=8787\n");
  assert.equal(current.BLOSSOM_ADMIN_PASSWORD, "long-enough-secret");
  assert.equal(missingSettings(current).BLOSSOM_ADMIN_PASSWORD, undefined);
  assert.equal(missingSettings(current).BLOSSOM_PORT, undefined);
});
