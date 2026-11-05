import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'assets/animation');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'sources.json'), 'utf8'));
const checks = [], errors = [], visualFrames = [], assets = [];
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const normalize = buffer => { for (let i = 0; i < buffer.length; i += 4) if (!buffer[i + 3]) buffer.fill(0, i, i + 3); return buffer; };
const imageData = async file => normalize(await sharp(file, { animated: true }).ensureAlpha().raw().toBuffer());
const url = (key, still = false) => 'data:image/webp;base64,' + fs.readFileSync(path.join(folder, key + (still ? '-still' : '') + '.webp')).toString('base64');

for (const record of manifest.assets) {
  const input = path.join(folder, record.file), output = path.join(folder, record.key + '.webp');
  assert.equal(hash(fs.readFileSync(input)), record.sha256);
  const original = await sharp(input, { animated: true }).metadata();
  const encoded = await sharp(output, { animated: true }).metadata();
  assert.equal(encoded.width, original.width);
  assert.equal(encoded.pageHeight, original.pageHeight);
  assert.equal(encoded.pages, original.pages);
  assert.equal(encoded.loop, original.loop);
  assert(encoded.hasAlpha);
  assert((await imageData(input)).equals(await imageData(output)), 'Every visible frame pixel and alpha must be preserved: ' + record.key);
  assert.deepEqual(encoded.delay, original.delay.map(ms => Math.round(ms / 1.25)));
  const inputMs = original.delay.reduce((a, b) => a + b), outputMs = encoded.delay.reduce((a, b) => a + b);
  assert.equal(inputMs / outputMs, 1.25);
  const stillFile = path.join(folder, record.key + '-still.webp');
  const still = await sharp(stillFile).metadata();
  assert.equal(still.pages || 1, 1);
  assert(normalize(await sharp(input).ensureAlpha().raw().toBuffer()).equals(await imageData(stillFile)), 'Static preview must match the first source frame');
  assets.push({ key: record.key, width: encoded.width, height: encoded.pageHeight, frames: encoded.pages, loop: encoded.loop, inputMs, outputMs, playbackRate: inputMs / outputMs, bytes: fs.statSync(output).size });
}
checks.push('all four user-supplied GIF source hashes match their unchanged originals');
checks.push('lossless animated WebP preserves every visible source pixel, transparency, frame count and infinite loop');
checks.push('every frame delay and all four loop durations use exactly 1.25x playback speed');
checks.push('static thumbnails and reduced-motion assets are exact first-frame copies');

const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
const code = source.replace(hook, '  window.__animationTest = { setStatus, lock, showPose };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    window.GM_getValue = () => ({});
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = () => { throw new Error('No API requests in animation checks'); };
  });
  await context.route('**/*', route => new URL(route.request().url()).pathname === '/work/fixture'
    ? route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<section class="questionLi"><h3 class="mark_name">1. 简答题：虚构练习</h3><textarea></textarea></section>' })
    : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const remoteImages = [];
  page.on('request', request => { if (request.resourceType() === 'image' && !request.url().startsWith('data:')) remoteImages.push(request.url()); });
  await page.goto('https://mooc1.chaoxing.com/work/fixture');
  await page.addScriptTag({ content: code });
  const shell = page.locator('#cxds-panel'), hero = shell.locator('[data-role=mascot]');
  await page.waitForFunction(() => [...document.querySelector('#cxds-panel').shadowRoot.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0));
  for (const record of manifest.assets) {
    await shell.locator('.pose[data-pose=' + record.key + ']').click();
    assert((await hero.getAttribute('src')) === url(record.key), 'Selected pose must use its embedded animation');
    await hero.evaluate(image => image.decode());
    const hashes = new Set();
    for (let i = 0; i < 4; i++) {
      hashes.add(hash(await hero.screenshot()));
      await page.waitForTimeout(170);
    }
    assert(hashes.size > 1, 'Browser must visibly play source frames: ' + record.key);
    visualFrames.push({ key: record.key, distinctScreenshots: hashes.size });
  }
  checks.push('all four embedded animations visibly change frames in the browser with a fixed image position');
  for (const record of manifest.assets) assert((await shell.locator('.pose[data-pose=' + record.key + '] img').getAttribute('src')) === url(record.key, true));
  checks.push('pose thumbnails remain static and use the new character artwork');

  for (const [status, key, busy] of [['等待开始', 'welcome', false], ['正在请求第 1 题', 'thinking', true], ['手动暂停', 'rest', false], ['当前页面填答完成，请核对后手动交卷', 'complete', false]]) {
    await page.evaluate(({ status, busy }) => { window.__animationTest.lock(busy); window.__animationTest.setStatus(status); }, { status, busy });
    assert.equal(await hero.getAttribute('data-pose'), key);
    assert((await hero.getAttribute('src')) === url(key), 'Status must select the matching animated artwork');
  }
  checks.push('idle, requesting, paused and complete statuses select the matching user animation');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#cxds-panel').shadowRoot.querySelector('[data-role=mascot]').dataset.motion === 'still');
  for (const record of manifest.assets) {
    await page.evaluate(key => window.__animationTest.showPose(key), record.key);
    assert((await hero.getAttribute('src')) === url(record.key, true), 'Reduced motion must replace GIF playback with a still');
  }
  checks.push('reduced-motion preference freezes all four poses using real static files');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelector('#cxds-panel').shadowRoot.querySelector('[data-role=mascot]').dataset.motion === 'animated');
  assert((await hero.getAttribute('src')) === url('complete'));
  checks.push('changing motion preference restores the current pose animation without a status reset');

  await page.keyboard.press('Alt+q');
  assert.equal(await shell.isVisible(), false);
  assert((await hero.getAttribute('src')) === url('complete', true));
  await page.keyboard.press('Alt+q');
  assert.equal(await shell.isVisible(), true);
  assert((await hero.getAttribute('src')) === url('complete'));
  checks.push('full hide stops both mascot animations and showing the interface restores the same pose');
  await shell.locator('.collapse').click();
  assert.equal(await shell.locator('.dock').isVisible(), true);
  assert((await shell.locator('[data-role=dock-mascot]').getAttribute('src')) === url('complete'));
  checks.push('the collapsed dock follows the current animated status');
  assert.deepEqual(remoteImages, []);
  assert.deepEqual(errors, []);
  checks.push('animated artwork remains embedded with no remote image or model requests');
  const report = { result: 'PASS', checks, browserErrors: errors, assets, visualFrames, limits: 'Actual user-provided artwork decoded and displayed in local browser fixtures. Model API and real course behavior are outside these animation checks.' };
  fs.writeFileSync(path.join(root, 'preview/动画检查.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
