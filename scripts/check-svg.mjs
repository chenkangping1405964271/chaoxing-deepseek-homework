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
const code = source.replace(hook, '  window.__svgTest = { run, stop, diagnosticReport };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [], errors = [];
const font = fs.readFileSync(path.join(root, 'scripts/fixtures/encoded-font.ttf')).toString('base64');
const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="8ex" height="3ex" viewBox="0 -10 80 30">${content}</svg>`;
const local = svg('<defs><path id="glyph" d="M5 0H25V8H5Z"/></defs><g fill="currentColor"><use href="#glyph"/><rect x="2" y="12" width="35" height="2"/></g>');
const red = svg('<rect x="0" y="0" width="40" height="15" fill="red"/>');
const global = '<svg hidden><defs><path id="global-glyph" d="M3 0H32V12H3Z"/><text id="unrelated">PRIVATE_OUTSIDE_QUESTION</text></defs></svg>';
const globalUse = svg('<g fill="currentColor"><use href="#global-glyph"/></g>');

async function setup(first = local, options = {}) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  await context.addInitScript(({ model }) => {
    window.__requests = [];
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model, autoNext: false, autoSubmit: false, delayMs: 0 });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      window.__requests.push(JSON.parse(request.data));
      const reply = () => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: ['B'], needs_review: false }) } }] }) });
      if (window.__hold) window.__reply = reply; else setTimeout(reply, 0);
      return { abort() { request.onabort(); } };
    };
  }, { model: options.model || 'deepseek-flash' });
  const fixture = `<style>body{background:white;font:18px Arial}.answer_p{color:#123456}svg{vertical-align:middle}${options.encrypted ? `@font-face{font-family:font-cxsecret;src:url(data:font/ttf;base64,${font})}.font-cxsecret{font-family:font-cxsecret!important}` : ''}</style>${options.globals || ''}
    <section class="questionLi"><input type="hidden" name="type101" value="0"><input type="hidden" id="answer101"><h3 class="mark_name">1. 单选题 ${options.encrypted ? '<span class="font-cxsecret">&#xe001;&#xe002;</span>' : '虚构公式'}${options.title || ''}</h3>
    <div class="answerBg" onclick="choose(this)"><span class="num_option" data="A">A</span><div class="answer_p">${first}</div></div>
    <div class="answerBg" onclick="choose(this)"><span class="num_option" data="B">B</span><div class="answer_p">${options.second || local}</div></div></section>
    <script>function choose(option){for(const marker of document.querySelectorAll('.num_option'))marker.classList.remove('check_answer');option.querySelector('.num_option').classList.add('check_answer');document.querySelector('#answer101').value=option.querySelector('.num_option').getAttribute('data');}</script>`;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mycourse/studentstudy') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<p>PRIVATE_OUTSIDE_QUESTION</p><iframe src="/work/fixture"></iframe>' });
    if (url.pathname === '/work/fixture') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: fixture });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy');
  await page.addScriptTag({ content: code });
  return { context, page, work: page.frames().find(frame => new URL(frame.url()).pathname === '/work/fixture') };
}

async function run(test, error) {
  await test.page.evaluate(() => window.__svgTest.run());
  const status = await test.page.locator('#cxds-panel [data-role=status]').textContent();
  assert.match(status, error || /填答完成/);
  if (error) assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  else assert.equal(await test.work.locator('#answer101').inputValue(), 'B');
}
async function parts(test) { return test.page.evaluate(() => window.__requests[0].messages[1].content); }
const bytes = part => Buffer.from(part.image_url.url.split(',')[1], 'base64');

try {
  let test = await setup();
  await run(test);
  const images = (await parts(test)).filter(part => part.type === 'image_url');
  assert.equal(images.length, 2);
  const pixels = await sharp(bytes(images[0])).removeAlpha().raw().toBuffer();
  let colored = 0;
  for (let i = 0; i < pixels.length; i += 3) if (pixels[i] < 100 && pixels[i + 1] < 150 && pixels[i + 2] < 180) colored++;
  assert(colored > 100);
  const report = await test.page.evaluate(() => window.__svgTest.diagnosticReport());
  assert.equal(report.questions[0].svgFormulaCount, 2);
  assert(!JSON.stringify(await parts(test)).includes('PRIVATE_OUTSIDE_QUESTION'));
  checks.push('pure SVG options with local glyph definitions, negative viewBox and inherited color become non-empty PNG inputs with correct labels');
  await test.context.close();

  test = await setup(globalUse, { globals: global });
  await run(test);
  assert.equal((await parts(test)).filter(part => part.type === 'image_url').length, 2);
  const globalPixels = await sharp(bytes((await parts(test)).find(part => part.type === 'image_url'))).removeAlpha().raw().toBuffer();
  let inheritedBlue = 0;
  for (let i = 0; i < globalPixels.length; i += 3) if (globalPixels[i + 2] > globalPixels[i] + 30 && globalPixels[i] < 100) inheritedBlue++;
  assert(inheritedBlue > 100);
  checks.push('global same-document glyph definitions are copied only when referenced by a formula');
  await test.context.close();

  test = await setup(local, { title: red });
  await run(test);
  assert.equal((await parts(test)).filter(part => part.type === 'image_url').length, 3);
  checks.push('title and option SVG formulas share the existing image request path');
  await test.context.close();

  test = await setup(red, { encrypted: true });
  await run(test);
  const imageParts = (await parts(test)).filter(part => part.type === 'image_url');
  assert.equal(imageParts.length, 3);
  const combined = await sharp(bytes(imageParts[1])).removeAlpha().raw().toBuffer();
  let redPixels = 0;
  for (let i = 0; i < combined.length; i += 3) if (combined[i] > 200 && combined[i + 1] < 50 && combined[i + 2] < 50) redPixels++;
  assert(redPixels > 100);
  assert(!/[\ue001\ue002]/u.test(JSON.stringify(await parts(test))));
  checks.push('encoded-font fragment rendering retains SVG formula pixels without sending encoded source text');
  await test.context.close();

  test = await setup(svg('<text x="1" y="10" font-size="12">x + 1</text>'));
  await run(test);
  checks.push('inline SVG text formulas are rasterized without duplicate fragment text drawing');
  await test.context.close();

  test = await setup(svg('<use href="#late-glyph"/>'));
  await test.work.evaluate(() => setTimeout(() => {
    const holder = document.createElement('div'); holder.innerHTML = '<svg hidden><defs><path id="late-glyph" d="M0 0H30V10H0Z"/></defs></svg>'; document.body.append(holder);
  }, 200));
  await run(test);
  checks.push('a late same-document glyph definition is awaited before requesting');
  await test.context.close();

  test = await setup(svg('<use href="https://other.example/glyph.svg#x"/>'));
  await run(test, /外部资源/);
  checks.push('external SVG references pause before a model request or external image read');
  await test.context.close();

  test = await setup(svg('<foreignObject width="50" height="20"><div xmlns="http://www.w3.org/1999/xhtml">unsupported</div></foreignObject>'));
  await run(test, /不支持的元素/);
  checks.push('SVG foreign content remains unsupported instead of being silently omitted');
  await test.context.close();

  test = await setup(svg('<defs><g id="loop"><use href="#loop"/></g></defs><use href="#loop"/>'));
  await run(test, /循环引用/);
  checks.push('cyclic SVG references stop before rendering');
  await test.context.close();

  test = await setup(local, { model: 'deepseek-v4-pro' });
  await run(test, /选择 deepseek-flash/);
  checks.push('SVG formulas require an image-capable model');
  await test.context.close();

  test = await setup();
  await test.work.evaluate(() => { Image.prototype.decode = () => new Promise(() => {}); });
  await test.page.evaluate(() => { window.__pending = window.__svgTest.run(); setTimeout(() => window.__svgTest.stop(), 30); });
  await test.page.evaluate(() => window.__pending);
  assert.equal(await test.page.locator('#cxds-panel [data-role=status]').textContent(), '手动暂停');
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('pause interrupts formula decoding without a later model request');
  await test.context.close();

  test = await setup('<canvas width="50" height="20"></canvas>');
  await run(test, /不支持的媒体/);
  checks.push('unsupported canvas/media still pause explicitly');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__hold = true; window.__pending = window.__svgTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  await test.work.evaluate(() => document.querySelector('.answer_p rect').setAttribute('width', '65'));
  await test.page.evaluate(() => { window.__reply(); return window.__pending; });
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), /页面发生变化/);
  assert.equal(await test.work.locator('#answer101').inputValue(), '');
  checks.push('formula changes while requesting prevent stale-answer writes');
  await test.context.close();

  assert.deepEqual(errors, []);
  const result = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional inline SVG, glyph, font and media fixtures; model requests mocked locally; no real course content or paid API.' };
  fs.writeFileSync(path.join(root, 'preview/SVG公式检查.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
