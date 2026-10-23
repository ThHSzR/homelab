import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

function xml(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function paragraphs(markdown) {
  return markdown.trim().split(/\n\s*\n/g).filter(Boolean).map(block => {
    const heading = block.match(/^#{1,3}\s+(.+)$/s);
    if (heading) return '<h2>' + xml(heading[1]) + '</h2>';
    return '<p>' + xml(block.trim()).replace(/\n/g, '<br/>') + '</p>';
  }).join('\n');
}
async function write(root, relative, data) {
  const filename = path.join(root, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, data, 'utf8');
}
function zip(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', data => { error = (error + data.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('zip falhou (' + code + '): ' + error)));
  });
}
/** Gera EPUB 3 mínimo, com mimetype como primeira entrada e sem compressão. */
export async function createEpub({ title, author, uuid, chapters, outputPath }) {
  if (!title || !uuid || !Array.isArray(chapters) || !chapters.length) throw new Error('Metadados EPUB inválidos');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fiction-epub-'));
  const target = path.resolve(outputPath);
  const partial = target + '.partial';
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rm(partial, { force: true });
    await write(temp, 'mimetype', 'application/epub+zip');
    await write(temp, 'META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n');
    await write(temp, 'OEBPS/style.css', 'body{font-family:serif;line-height:1.5;margin:5%}h1{text-align:center}h2{margin-top:1.5em}p{text-indent:1em;margin:.45em 0}nav ol{line-height:2}\n');
    const manifest = ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="css" href="style.css" media-type="text/css"/>'];
    const spine = [];
    const nav = [];
    for (let i = 0; i < chapters.length; i++) {
      const n = i + 1;
      const name = 'text/chapter-' + String(n).padStart(2, '0') + '.xhtml';
      manifest.push('<item id="c' + n + '" href="' + name + '" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="c' + n + '"/>');
      nav.push('<li><a href="' + name + '">Capítulo ' + n + '</a></li>');
      await write(temp, 'OEBPS/' + name,
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt-BR"><head><meta charset="UTF-8"/><title>Capítulo ' + n + '</title><link rel="stylesheet" type="text/css" href="../style.css"/></head><body><h1>Capítulo ' + n + '</h1>\n' + paragraphs(chapters[i]) + '\n</body></html>\n');
    }
    await write(temp, 'OEBPS/nav.xhtml',
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR"><head><meta charset="UTF-8"/><title>Sumário</title></head><body><nav epub:type="toc" id="toc"><h1>Sumário</h1><ol>' + nav.join('') + '</ol></nav></body></html>\n');
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await write(temp, 'OEBPS/content.opf',
      '<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="pt-BR"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:' + xml(uuid) + '</dc:identifier><dc:title>' + xml(title) + '</dc:title><dc:creator>' + xml(author || 'Autor local') + '</dc:creator><dc:language>pt-BR</dc:language><meta property="dcterms:modified">' + modified + '</meta></metadata><manifest>' + manifest.join('') + '</manifest><spine>' + spine.join('') + '</spine></package>\n');
    // EPUB exige mimetype primeiro e sem compressão.
    await zip(temp, ['-X0', partial, 'mimetype']);
    await zip(temp, ['-Xr9', partial, 'META-INF', 'OEBPS']);
    await fs.rename(partial, target);
    return target;
  } finally {
    await fs.rm(partial, { force: true });
    await fs.rm(temp, { recursive: true, force: true });
  }
}
