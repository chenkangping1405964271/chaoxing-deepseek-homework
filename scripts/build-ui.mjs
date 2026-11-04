import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const art = {};
const sizes = [];
for (const key of ['welcome', 'thinking', 'rest', 'complete']) {
  const input = path.join(root, 'assets', `${key}.png`);
  const metadata = await sharp(input).metadata();
  if (!metadata.hasAlpha) throw new Error(`Asset has no alpha: ${key}`);
  // Keep the generated masters. These smaller WebP copies are only delivery encodings.
  const webp = await sharp(input).resize(440, 440, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 100 }).toBuffer();
  fs.writeFileSync(path.join(root, 'assets', `${key}.webp`), webp);
  art[key] = `data:image/webp;base64,${webp.toString('base64')}`;
  sizes.push({ key, masterBytes: fs.statSync(input).size, embeddedBytes: webp.length });
}
let code = fs.readFileSync(path.join(root, 'src/homework.template.js'), 'utf8');
for (const token of ['__CXDS_ART__', '__CXDS_PANEL__']) {
  if (code.split(token).length !== 2) throw new Error(`Expected one build token: ${token}`);
}
code = code.replace('__CXDS_ART__', JSON.stringify(art)).replace('__CXDS_PANEL__', JSON.stringify(fs.readFileSync(path.join(root, 'src/panel.html'), 'utf8')));
new vm.Script(code, { filename: 'chaoxing-deepseek-homework.user.js' });
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'chaoxing-deepseek-homework.user.js'), code);
const metadataEnd = code.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length;
if (metadataEnd < '// ==/UserScript=='.length) throw new Error('Userscript metadata header is missing');
fs.writeFileSync(path.join(out, 'chaoxing-deepseek-homework.meta.js'), code.slice(0, metadataEnd) + '\n');
console.log(JSON.stringify({ syntax: 'PASS', scriptBytes: Buffer.byteLength(code), assets: sizes }, null, 2));
