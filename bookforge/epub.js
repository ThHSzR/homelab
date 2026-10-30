'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function xml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A simple ZIP writer: EPUB permits stored (uncompressed) members.
// The first member MUST be an uncompressed "mimetype" file.
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    chunks.push(local, filename, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += local.length + filename.length + data.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

function paragraphs(text) {
  return String(text).trim().split(/\n\s*\n/).filter(Boolean).map(block => {
    const escaped = xml(block.trim()).replace(/\n/g, '<br/>');
    return '<p>' + escaped + '</p>';
  }).join('\n');
}

function buildEpub({ title, author = 'Biblioteca IA', chapters, identifier = crypto.randomUUID() }) {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new Error('EPUB exige pelo menos um capitulo');
  }
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const entries = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>']
  ];
  const navItems = [];
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>'
  ];
  const spine = [];
  chapters.forEach((chapter, i) => {
    const id = 'c' + (i + 1);
    const file = id + '.xhtml';
    const heading = chapter.title || 'Capitulo ' + (i + 1);
    navItems.push('<li><a href="' + file + '">' + xml(heading) + '</a></li>');
    manifest.push('<item id="' + id + '" href="' + file + '" media-type="application/xhtml+xml"/>');
    spine.push('<itemref idref="' + id + '"/>');
    const page = '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt-BR"><head>' +
      '<title>' + xml(heading) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head>' +
      '<body><h1>' + xml(heading) + '</h1>' + paragraphs(chapter.text) + '</body></html>';
    entries.push(['OEBPS/' + file, page]);
  });
  entries.push(['OEBPS/nav.xhtml', '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR">' +
    '<head><title>Sumario</title></head><body><nav epub:type="toc" id="toc"><h1>Sumario</h1><ol>' +
    navItems.join('') + '</ol></nav></body></html>']);
  entries.push(['OEBPS/style.css', 'body{line-height:1.5;margin:5%;}p{text-indent:1.3em;margin:.5em 0;}h1{margin:1.5em 0;}']);
  entries.push(['OEBPS/content.opf', '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="pt-BR">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:identifier id="uid">urn:uuid:' + xml(identifier) + '</dc:identifier>' +
    '<dc:title>' + xml(title) + '</dc:title><dc:creator>' + xml(author) + '</dc:creator>' +
    '<dc:language>pt-BR</dc:language><meta property="dcterms:modified">' + modified + '</meta></metadata>' +
    '<manifest>' + manifest.join('') + '</manifest><spine>' + spine.join('') + '</spine></package>']);
  return zip(entries);
}

function writeEpub(options, destination) {
  const data = buildEpub(options);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, destination);
  return destination;
}

module.exports = { buildEpub, writeEpub, xml };
