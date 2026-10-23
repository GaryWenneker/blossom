import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const setup = join(root,"setup.sh");
async function executable(path, content) {
  await writeFile(path, content, { mode:0o755 });
  await chmod(path,0o755);
}
test("Blossom setup does not tap/trust or remove other Homebrew taps", async () => {
  const source = await readFile(setup,"utf8");
  assert.match(source,/install_brew_package draw-things-cli/);
  assert.doesNotMatch(source,/\bbrew (?:tap|untap|trust|untrust)\b/);
  assert.doesNotMatch(source,/install_brew_package drawthingsai\//);
  assert.match(source,/official Homebrew core/);
});
test("Missing CLI installs from Homebrew core even if an unrelated tap warning is shown", async () => {
  const dir = await mkdtemp(join(tmpdir(),"blossom-homebrew-test-"));
  const logfile=join(dir,"brew.log");
  try {
    await executable(join(dir,"uname"),"#!/bin/sh\necho Darwin\n");
    await executable(join(dir,"node"),"#!/bin/sh\nif [ \"$1\" = \"-e\" ]; then exit 0; fi\necho NODE_SETUP_INVOKED\n");
    for(const tool of ["ffmpeg","ffprobe","cargo","cloudflared"])
      await executable(join(dir,tool),"#!/bin/sh\nexit 0\n");
    await executable(join(dir,"brew"),[
      "#!/bin/bash",
      'echo "$*" >> "$BREW_LOG"',
      'case "$1" in',
      '  list) exit 1 ;;',
      '  --prefix) echo "$FAKE_BIN_DIR"; exit 0 ;;',
      '  install)',
      '    if [ "$2" = "draw-things-cli" ]; then',
      '      echo "#!/bin/sh" > "$FAKE_BIN_DIR/draw-things-cli"',
      '      echo "exit 0" >> "$FAKE_BIN_DIR/draw-things-cli"',
      '      chmod +x "$FAKE_BIN_DIR/draw-things-cli"',
      '      echo "Warning: The following taps are not trusted: libkrun/krun" >&2',
      '    fi',
      '    exit 0 ;;',
      'esac',
      'exit 0',
      ""
    ].join("\n"));
    // Exercise the real install decisions but replace only the PATH bootstrap
    // in a temporary copy, so CI's /usr/local/bin/node cannot escape the mocks.
    const script=await readFile(setup,"utf8");
    const fixture=join(dir,"setup-under-test.sh");
    assert.match(script,/export PATH="\/opt\/homebrew\/bin:.*\$PATH"/);
    await writeFile(fixture,script.replace(
      /export PATH="\/opt\/homebrew\/bin:\/usr\/local\/bin:\$HOME\/\.cargo\/bin:\$PATH"/,
      'export PATH="' + dir + ':$PATH"'));
    const {stdout}=await run("bash",[fixture,"--headless"],{
      cwd:root,timeout:20000,env:{...process.env,HOME:dir,PATH:dir+":/usr/bin:/bin",BREW_LOG:logfile,FAKE_BIN_DIR:dir}
    });
    assert.match(stdout,/NODE_SETUP_INVOKED/);
    const entries=await readFile(logfile,"utf8");
    assert.match(entries,/install draw-things-cli/);
    assert.doesNotMatch(entries,/(?:^|\n)(?:tap|trust|untap|untrust) /);
    assert.doesNotMatch(entries,/drawthingsai\/draw-things/);
    assert.doesNotMatch(entries,/libkrun/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
