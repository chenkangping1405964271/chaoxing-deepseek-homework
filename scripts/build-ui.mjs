import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const art = {};
const motionArt = {};
const sizes = [];
const animationFolder = path.join(root, 'assets/animation');
const playbackRate = JSON.parse(fs.readFileSync(path.join(animationFolder, 'sources.json'), 'utf8')).playbackRate;
if (!Number.isFinite(playbackRate) || playbackRate <= 0) throw new Error('Invalid animation playback rate');
for (const key of ['welcome', 'thinking', 'rest', 'complete']) {
  const input = path.join(animationFolder, `${key}.gif`);
  const metadata = await sharp(input, { animated: true }).metadata();
  if (!metadata.hasAlpha) throw new Error(`Asset has no alpha: ${key}`);
  if (metadata.pages < 2 || metadata.delay?.length !== metadata.pages) throw new Error(`Asset has no animation timing: ${key}`);
  const delay = metadata.delay.map(ms => Math.max(1, Math.round(ms / playbackRate)));
  // Preserve all source frames and pixels. WebP stores the 1.25x timings in milliseconds.
  const animated = await sharp(input, { animated: true }).webp({ lossless: true, loop: metadata.loop, delay, effort: 6 }).toBuffer();
  const still = await sharp(input).webp({ lossless: true, effort: 6 }).toBuffer();
  fs.writeFileSync(path.join(animationFolder, `${key}.webp`), animated);
  fs.writeFileSync(path.join(animationFolder, `${key}-still.webp`), still);
  art[key] = `data:image/webp;base64,${still.toString('base64')}`;
  motionArt[key] = `data:image/webp;base64,${animated.toString('base64')}`;
  sizes.push({ key, masterBytes: fs.statSync(input).size, frames: metadata.pages, playbackRate, durationMs: delay.reduce((sum, ms) => sum + ms, 0), animatedBytes: animated.length, stillBytes: still.length });
}
let code = fs.readFileSync(path.join(root, 'src/homework.template.js'), 'utf8');
for (const token of ['__CXDS_ART__', '__CXDS_MOTION_ART__', '__CXDS_PANEL__']) {
  if (code.split(token).length !== 2) throw new Error(`Expected one build token: ${token}`);
}
code = code.replace('__CXDS_ART__', JSON.stringify(art)).replace('__CXDS_MOTION_ART__', JSON.stringify(motionArt)).replace('__CXDS_PANEL__', JSON.stringify(fs.readFileSync(path.join(root, 'src/panel.html'), 'utf8')));
new vm.Script(code, { filename: 'chaoxing-deepseek-homework.user.js' });
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'chaoxing-deepseek-homework.user.js'), code);
const metadataEnd = code.indexOf('// ==/UserScript==') + '// ==/UserScript=='.length;
if (metadataEnd < '// ==/UserScript=='.length) throw new Error('Userscript metadata header is missing');
fs.writeFileSync(path.join(out, 'chaoxing-deepseek-homework.meta.js'), code.slice(0, metadataEnd) + '\n');
console.log(JSON.stringify({ syntax: 'PASS', scriptBytes: Buffer.byteLength(code), assets: sizes }, null, 2));
