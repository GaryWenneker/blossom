import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatGptImages } from '../src/chatgpt-images.mjs';

test('image Safari target survives page title changes and stays in its own window', async () => {
  const source = await readFile(new URL('../scripts/chatgpt-safari-lyrics.applescript', import.meta.url), 'utf8');
  const image = source.slice(source.indexOf('on runImage(argv)'));
  assert.doesNotMatch(image, /imageDocument/);
  assert.match(image, /set imageWindowId to id of front window/);
  assert.equal((image.match(/do JavaScript \w+ in tab 1 of window id imageWindowId/g) || []).length, 2);
  assert.equal((image.match(/URL of tab 1 of window id imageWindowId/g) || []).length, 2);
});

for (const kind of ['cover', 'track-art', 'artist-photo']) {
  test(kind + ' exports and saves the returned ChatGPT PNG', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'blossom-image-target-'));
    const png = Buffer.alloc(32);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
    png.write('IHDR', 12); png.writeUInt32BE(1024, 16); png.writeUInt32BE(1024, 20);
    try {
      const generator = new ChatGptImages({ directory, platform: 'darwin',
        runner(script, args, options, callback) {
          assert.match(script, /chatgpt-safari-lyrics.applescript$/);
          assert.equal(args.length, 4);
          assert.match(args[1], kind === 'artist-photo' ? /fictional musician artist portrait/ : kind === 'track-art' ? /Square track sleeve/ : /Square album cover/);
          if (kind !== 'artist-photo') assert.match(args[1], /Do not default to a small title centered along the top/);
          callback(null, 'REPLY\n' + 'data:image/png;base64,' + png.toString('base64'));
        }
      });
      const asset = await generator.generate({kind, prompt:'Original visual for this song'});
      assert.equal(asset.provider, 'chatgpt');
      assert.deepEqual(await readFile(join(directory, asset.filename)), png);
    } finally { await rm(directory, {recursive:true, force:true}); }
  });
}
