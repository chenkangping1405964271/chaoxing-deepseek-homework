import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
assert(!source.includes('__cxdsFontTest'));
const instrumented = source.replace(hook, '  window.__cxdsFontTest = { run, stop };\n' + hook);
const font = fs.readFileSync(path.join(root, 'scripts/fixtures/encoded-font.ttf')).toString('base64');
const formula = 'data:image/png;base64,' + (await sharp({ create: { width: 20, height: 10, channels: 4, background: '#ff0000' } }).png().toBuffer()).toString('base64');
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [], errors = [];

async function setup({ loaded = true, image = false, model = 'deepseek-flash', review = false, answer = 'A' } = {}) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.addInitScript(options => {
    window.__requests = [];
    window.GM_getValue = () => ({ apiKey: 'fixture-private-key', model: options.model, autoNext: false, autoSubmit: false, delayMs: 0 });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      window.__requests.push(JSON.parse(request.data));
      setTimeout(() => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
        content: JSON.stringify({ answers: [options.answer], needs_review: options.review })
      } }] }) }), 0);
      return { abort() { request.onabort(); } };
    };
  }, { model, review, answer });
  const question = `<style>${loaded ? `@font-face{font-family:'font-cxsecret';src:url(data:font/ttf;base64,${font})}` : ''}
    body{background:white;margin:20px;font:16px Arial}.font-cxsecret,.font-cxsecret *{font-family:'font-cxsecret'!important}.glyph{display:inline-block;font-size:40px;line-height:40px}
    li{margin-top:10px}label{display:inline-block;width:20px}img{width:20px;height:10px}</style>
    <div class="TiMu"><div class="mark_name"><span class="font-cxsecret glyph">&#xe001;&#xe002;</span>${image ? `<img src="${formula}">` : ''}</div>
    <ul class="Zy_ulTop" aria-hidden="true"><li><label>A</label><a class="after font-cxsecret glyph">&#xe001;</a></li><li><label>B</label><a class="after font-cxsecret glyph">&#xe002;</a></li></ul>
    <input type="hidden" id="answertype1" value="3"><input id="saved" type="hidden"></div>
    <script>document.addEventListener('click',event=>{const li=event.target.closest('li');if(!li)return;for(const other of document.querySelectorAll('li'))other.setAttribute('aria-checked',String(other===li));document.querySelector('#saved').value=li.querySelector('label').textContent;});</script>`;
  await context.route('**/*', route => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/mycourse/studentstudy') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<p>PRIVATE_OUTSIDE_QUESTION</p><input value="PRIVATE_OUTSIDE_QUESTION"><iframe src="/work"></iframe>' });
    if (p === '/work') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: question });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  await page.addScriptTag({ content: instrumented });
  return { context, page, work: page.frames().find(f => new URL(f.url()).pathname === '/work') };
}
const run = test => test.page.evaluate(() => window.__cxdsFontTest.run());
const status = test => test.page.locator('#cxds-panel [data-role="status"]').textContent();
const content = test => test.page.evaluate(() => window.__requests[0]?.messages[1].content);
const imageBytes = part => Buffer.from(part.image_url.url.split(',')[1], 'base64');

try {
  let test = await setup();
  await test.work.evaluate(() => document.fonts.ready);
  const expected = await test.work.locator('.mark_name .glyph').screenshot();
  await run(test);
  assert.match(await status(test), /填答完成/);
  assert.equal(await test.work.locator('#saved').inputValue(), 'A');
  assert.equal(await test.page.evaluate(() => [...document.fonts].some(face => face.family.includes('font-cxsecret'))), false, 'The parent does not have the child font');
  const parts = await content(test), serialized = JSON.stringify(parts);
  assert.equal(parts.filter(p => p.type === 'image_url').length, 3);
  assert(parts.filter(p => p.type === 'image_url').every(p => p.image_url.url.startsWith('data:image/png;base64,')));
  assert(!/[\ue001\ue002]/u.test(serialized), 'Encoded text must not be sent as text');
  assert(!serialized.includes('PRIVATE_OUTSIDE_QUESTION'));
  assert(!serialized.includes('fixture-private-key'));
  const actualPixels = await sharp(imageBytes(parts.find(p => p.type === 'image_url'))).flatten({ background: '#fff' }).trim({ background: '#fff', threshold: 10 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const expectedPixels = await sharp(expected).flatten({ background: '#fff' }).trim({ background: '#fff', threshold: 10 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(actualPixels.info.width, expectedPixels.info.width);
  assert.equal(actualPixels.info.height, expectedPixels.info.height);
  let totalDifference = 0;
  for (let i = 0; i < actualPixels.data.length; i++) totalDifference += Math.abs(actualPixels.data[i] - expectedPixels.data[i]);
  assert(totalDifference / actualPixels.data.length < 3, 'Rendered glyphs must match the browser font appearance');
  checks.push('child-frame custom glyph pixels match the browser appearance; native selection persists; text payload excludes encoded characters and surrounding content');
  await test.context.close();

  test = await setup({ image: true });
  await run(test);
  assert.match(await status(test), /填答完成/);
  const pixels = await sharp(imageBytes((await content(test)).find(p => p.type === 'image_url'))).removeAlpha().raw().toBuffer();
  let red = 0;
  for (let i = 0; i < pixels.length; i += 3) if (pixels[i] > 240 && pixels[i + 1] < 10 && pixels[i + 2] < 10) red++;
  assert(red >= 700, 'Formula image must remain visible in the rendered title');
  checks.push('inline formula images are drawn into the same title image without tainting the canvas');
  await test.context.close();

  test = await setup({ loaded: false });
  await run(test);
  assert.match(await status(test), /加密字体尚未加载/);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('missing custom font pauses before sending an incorrect fallback image');
  await test.context.close();

  test = await setup({ model: 'deepseek-v4-pro' });
  await run(test);
  assert.match(await status(test), /选择 deepseek-flash/);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('text-only model receives a specific switch-to-vision message before requesting');
  await test.context.close();

  test = await setup();
  await test.work.evaluate(() => { document.fonts.load = () => new Promise(() => {}); });
  await test.page.evaluate(() => { window.__pending = window.__cxdsFontTest.run(); setTimeout(() => window.__cxdsFontTest.stop(), 30); });
  await test.page.evaluate(() => window.__pending);
  assert.equal(await status(test), '手动暂停');
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('pause interrupts pending font preparation and prevents a later model request');
  await test.context.close();

  test = await setup({ review: true });
  await run(test);
  assert.match(await status(test), /模型要求人工检查/);
  assert.equal(await test.work.locator('#saved').inputValue(), '');
  checks.push('model uncertainty leaves answers untouched');
  await test.context.close();

  test = await setup({ answer: '\ue001' });
  await run(test);
  assert.match(await status(test), /无法唯一匹配选项/);
  assert.equal(await test.work.locator('#saved').inputValue(), '');
  checks.push('visual answers must match option letters instead of matching encoded source strings');
  await test.context.close();

  assert.deepEqual(errors, []);
  const report = { result: 'PASS', checks, browserErrors: errors, limits: 'Original geometric test font and fictional questions; mocked API only. No real course font or course content included.' };
  fs.writeFileSync(path.join(root, 'preview/加密字体检查.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
