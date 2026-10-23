'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildEpub, writeEpub, xml } = require('../epub');
const { address, number } = require('../bookforge');

test('EPUB has uncompressed mimetype as first ZIP entry', () => {
  const buffer = buildEpub({ title: 'Crime & Misterio', chapters: [{ title: 'Capitulo 1', text: 'O detetive chegou.\n\nUma pista apareceu.' }] });
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  assert.equal(buffer.readUInt16LE(8), 0); // compression method: store
  const nameLength = buffer.readUInt16LE(26);
  assert.equal(buffer.subarray(30, 30 + nameLength).toString(), 'mimetype');
  const dataStart = 30 + nameLength;
  const dataLength = buffer.readUInt32LE(18);
  assert.equal(buffer.subarray(dataStart, dataStart + dataLength).toString(), 'application/epub+zip');
  assert.ok(buffer.includes(Buffer.from('OEBPS/content.opf')));
  assert.ok(buffer.includes(Buffer.from('OEBPS/nav.xhtml')));
  assert.ok(buffer.includes(Buffer.from('OEBPS/c1.xhtml')));
  assert.ok(buffer.includes(Buffer.from('Crime &amp; Misterio')));
});

test('EPUB is written atomically and contains chapter text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookforge-test-'));
  try {
    const destination = path.join(dir, 'livro.epub');
    writeEpub({ title: 'Teste', chapters: [{ text: 'Pista & segredo <invisivel>' }] }, destination);
    const buffer = fs.readFileSync(destination);
    assert.ok(buffer.includes(Buffer.from('Pista &amp; segredo &lt;invisivel&gt;')));
    assert.ok(buffer.length > 1000);
    assert.deepEqual(fs.readdirSync(dir), ['livro.epub']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('EPUB requires chapters and escapes metadata', () => {
  assert.throws(() => buildEpub({ title: 'Vazio', chapters: [] }), /capitulo/);
  assert.equal(xml('A&B<"'), 'A&amp;B&lt;&quot;');
});

test('Kindle address validation and numeric limits', () => {
  assert.equal(address('reader@example.com'), true);
  assert.equal(address('bad\r\nBcc:evil@example.com'), false);
  assert.equal(address('foo@localhost'), false);
  assert.equal(number('BOOKFORGE_TEST_MISSING', 3, 1, 8), 3);
  process.env.BOOKFORGE_TEST_LIMIT = '99';
  try { assert.throws(() => number('BOOKFORGE_TEST_LIMIT', 3, 1, 8), /inteiro/); }
  finally { delete process.env.BOOKFORGE_TEST_LIMIT; }
});
