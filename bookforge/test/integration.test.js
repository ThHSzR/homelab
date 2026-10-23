'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('end-to-end local generation, EPUB and checkpoint resume (fake model only)', {
  skip: process.platform === 'win32',
  timeout: 90000
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookforge-integration-'));
  try {
    const model = path.join(temp, 'fake.gguf');
    const wrapper = path.join(temp, 'llama-server');
    const fake = path.join(__dirname, '..', 'fixtures', 'mock-llama-server.js');
    const data = path.join(temp, 'data');
    const script = path.join(__dirname, '..', 'bookforge.js');
    fs.writeFileSync(model, 'GGUF test fixture');
    fs.writeFileSync(wrapper, '#!/bin/sh\nexec "' + process.execPath + '" "' + fake + '" "$@"\n', { mode: 0o700 });
    const env = {
      ...process.env, BOOK_DATA_DIR: data, BOOK_MODEL: model, BOOK_LLAMA_SERVER: wrapper,
      BOOK_PORT: String(await unusedPort()), BOOK_MIN_AVAILABLE_MB: '0',
      BOOK_COOLDOWN_SECONDS: '0', BOOK_CHAPTERS: '2', BOOK_SCENES_PER_CHAPTER: '1',
      BOOK_MAX_TOKENS: '128', BOOK_AUTO_SEND: '0'
    };
    function execute(command) {
      const result = spawnSync(process.execPath, [script, command], {
        env, encoding: 'utf8', timeout: 45000
      });
      assert.equal(result.status, 0, 'failed: ' + result.stdout + '\n' + result.stderr);
      return result.stdout;
    }
    execute('run');
    const directories = fs.readdirSync(path.join(data, 'books'));
    assert.equal(directories.length, 1);
    const dir = path.join(data, 'books', directories[0]);
    const metadataFile = path.join(dir, 'book.json');
    const book = JSON.parse(fs.readFileSync(metadataFile));
    assert.equal(book.status, 'ready');
    assert.equal(book.chapters, 2);
    assert.ok(fs.statSync(path.join(dir, 'livro.epub')).size > 1000);
    assert.equal(fs.existsSync(path.join(dir, 'submission.json')), false);
    const scene = path.join(dir, 'scenes', 'c1-s1.txt');
    const original = fs.readFileSync(scene, 'utf8');
    assert.match(original, /investigadora/);
    assert.match(execute('status'), /"ready"/);

    // Simulate interruption after all scene checkpoints but before EPUB export.
    fs.writeFileSync(metadataFile, JSON.stringify({ ...book, status: 'writing' }));
    fs.unlinkSync(path.join(dir, 'livro.epub'));
    execute('run');
    assert.equal(fs.readFileSync(scene, 'utf8'), original);
    assert.equal(fs.readdirSync(path.join(data, 'books')).length, 1);
    assert.equal(JSON.parse(fs.readFileSync(metadataFile)).status, 'ready');
    assert.ok(fs.existsSync(path.join(dir, 'livro.epub')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
