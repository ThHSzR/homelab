import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createEpub } from '../src/epub.mjs';

const available = name => spawnSync('sh', ['-c', 'command -v ' + name], { encoding: 'utf8' }).status === 0;
test('gera EPUB 3 válido com mimetype primeiro e capítulos escapados', { skip: !available('zip') || !available('unzip') }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fiction-test-'));
  try {
    const epub = path.join(dir, 'livro.epub');
    await createEpub({
      title: 'Mistério & Noite',
      author: 'Autor <local>',
      uuid: '11111111-2222-3333-4444-555555555555',
      chapters: ['O detetive entrou no <porão>.\n\nUma pista.', 'O culpado disse: "adeus".'],
      outputPath: epub
    });
    assert.ok((await fs.stat(epub)).size > 200);
    const listing = spawnSync('unzip', ['-Z1', epub], { encoding: 'utf8' });
    assert.equal(listing.status, 0, listing.stderr);
    assert.equal(listing.stdout.trim().split('\n')[0], 'mimetype');
    const mime = spawnSync('unzip', ['-p', epub, 'mimetype'], { encoding: 'utf8' });
    assert.equal(mime.stdout, 'application/epub+zip');
    const chapter = spawnSync('unzip', ['-p', epub, 'OEBPS/text/chapter-01.xhtml'], { encoding: 'utf8' });
    assert.match(chapter.stdout, /&lt;porão&gt;/);
    const opf = spawnSync('unzip', ['-p', epub, 'OEBPS/content.opf'], { encoding: 'utf8' });
    assert.match(opf.stdout, /Mistério &amp; Noite/);
    const integrity = spawnSync('unzip', ['-t', epub], { encoding: 'utf8' });
    assert.equal(integrity.status, 0, integrity.stderr);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
