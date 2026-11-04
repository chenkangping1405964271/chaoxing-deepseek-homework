import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2, 'Unique test instrumentation point');
assert(!source.includes('__cxdsUiTest'), 'Production build contains no test API');
const instrumented = source.replace(hook, '  window.__cxdsUiTest = { setStatus, lock };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge, 'Microsoft Edge is required for local browser checks');
const browser = await chromium.launch({ executablePath: edge, headless: true });
const errors = [];
const requests = [];
const checks = [];
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>DeepSeek 娘作业小屋 · 本地界面预览</title>
<style>body{margin:0;background:#edf3f7;color:#45637d;font-family:"Microsoft YaHei",sans-serif}main{max-width:650px;margin:76px 450px 0 58px}small{letter-spacing:.2em;color:#9aaebe}h1{font-size:31px;margin:18px 0 12px;color:#385774}p{font-size:13px;line-height:1.9;color:#8ba0b0}.lesson{padding:25px;margin-top:28px;border:1px solid #dce7ee;border-radius:20px;background:#ffffffbb}.questionLi{margin-top:22px;padding:20px;background:white;border-radius:15px;border:1px solid #e1eaf1;font-size:13px}.questionLi h3{font-size:14px}.option{padding:12px;border-top:1px solid #edf2f6;color:#8297a8}@media(max-width:600px){main{margin:24px 20px}h1{font-size:24px}}</style>
<main><small>WHALE STUDY ROOM</small><h1>给学习，留一点可爱。</h1><p>这是本地虚构页面，用来检查新版界面的排版与交互。<br>页面不会访问学习通，也不会调用真实模型。</p><section class="lesson">章节练习 <span style="float:right;color:#a9b9c5;font-size:12px">本地演示</span>
<div class="questionLi"><h3 class="mark_name">1.（单选题）以下哪一种动物生活在海洋中？</h3><div class="option">A. 鲸鱼</div><div class="option">B. 小兔</div></div></section></main></html>`;

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(fixture);
  await page.evaluate(() => {
    window.__demoStorage = {};
    window.GM_getValue = (_key, fallback) => fallback;
    window.GM_setValue = (key, value) => { window.__demoStorage[key] = value; };
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = () => { throw new Error('Network calls are disabled in the UI preview'); };
  });
  await page.addScriptTag({ content: instrumented });
  const shell = page.locator('#cxds-panel');
  await shell.locator('img').first().waitFor();
  await page.waitForFunction(() => [...document.querySelector('#cxds-panel').shadowRoot.querySelectorAll('img')].every(i => i.complete && i.naturalWidth > 0));
  assert.equal(await shell.locator('.pose').count(), 4);
  assert.equal(await shell.locator('[data-action]').count(), 7);
  assert.equal(await shell.locator('[data-field]').count(), 6);
  assert.equal(await shell.locator('[data-role="connection"]').getAttribute('open'), '');
  assert.equal(await shell.locator('[data-field="autoSubmit"]').isChecked(), false);
  checks.push('four embedded illustrations decode; all existing controls mount; auto-submit default stays off');

  for (const [pose, label] of [['thinking', '认真思考'], ['rest', '歇一小会'], ['complete', '小小庆祝'], ['welcome', '打个招呼']]) {
    await shell.locator(`.pose[data-pose="${pose}"]`).click();
    assert.equal(await shell.locator('[data-role="mascot"]').getAttribute('data-pose'), pose);
    assert.equal(await shell.locator('.pose[aria-pressed="true"]').count(), 1);
    assert.equal(await shell.locator('[data-role="companion-caption"]').textContent(), '贴纸预览 · ' + label);
    assert.equal(await shell.locator('[data-role="status"]').textContent(), '等待开始');
  }
  checks.push('sticker previews do not falsify the runtime status');
  await shell.locator('[data-role="mascot"]').evaluate(el => { el.src = 'data:image/webp;base64,AAAA'; });
  await shell.locator('.fallback').waitFor({ state: 'visible' });
  await shell.locator('.pose[data-pose="rest"]').click();
  await page.waitForFunction(() => document.querySelector('#cxds-panel').shadowRoot.querySelector('[data-role="mascot"]').naturalWidth > 0);
  assert.equal(await shell.locator('.fallback').isVisible(), false);
  checks.push('broken-image fallback is visible; selecting another pose restores the illustration');
  await page.evaluate(() => window.__cxdsUiTest.setStatus('等待开始'));
  await shell.locator('[data-field="apiKey"]').fill('local-ui-fixture-key-only');
  await shell.locator('[data-field="model"]').fill('local-preview-model');
  await shell.locator('[data-action="save"]').click();
  assert.equal(await shell.locator('[data-field="apiKey"]').inputValue(), '');
  assert.equal(await shell.locator('[data-role="key-state"]').textContent(), '已配置');
  assert(!(await shell.evaluate(el => el.shadowRoot.innerHTML)).includes('local-ui-fixture-key-only'));
  await shell.locator('[data-action="clearKey"]').click();
  assert.equal(await shell.locator('[data-role="key-state"]').textContent(), '待配置');
  checks.push('save clears password field; clear-key and configuration indicator work');

  await page.evaluate(() => { window.__cxdsUiTest.lock(true); window.__cxdsUiTest.setStatus('正在请求第 1 题'); });
  assert.equal(await shell.locator('.box').getAttribute('data-tone'), 'working');
  assert.equal(await shell.locator('[data-role="mascot"]').getAttribute('data-pose'), 'thinking');
  assert.equal(await shell.locator('[data-action="stop"]').isDisabled(), false);
  assert.equal(await shell.locator('.pose:disabled').count(), 4);
  await shell.locator('[data-action="stop"]').click();
  assert.equal(await shell.locator('[data-role="status"]').textContent(), '手动暂停');
  assert.equal(await shell.locator('[data-role="mascot"]').getAttribute('data-pose'), 'rest');
  await page.evaluate(() => { window.__cxdsUiTest.lock(true); window.__cxdsUiTest.setStatus('当前页面填答完成，请检查作业及提交状态'); window.__cxdsUiTest.lock(false); });
  assert.equal(await shell.locator('.box').getAttribute('data-tone'), 'complete');
  assert.equal(await shell.locator('[data-role="mascot"]').getAttribute('data-pose'), 'complete');
  await shell.screenshot({ path: path.join(root, 'preview/完成状态.png') });
  checks.push('busy, manual pause and completion switch artwork and preserve button locking');

  await shell.locator('.collapse').click();
  assert.equal(await shell.locator('.box').isVisible(), false);
  assert.equal(await shell.locator('.dock').isVisible(), true);
  await shell.screenshot({ path: path.join(root, 'preview/收起状态.png') });
  await shell.locator('.dock').click();
  assert.equal(await shell.locator('.box').isVisible(), true);
  await shell.locator('.collapse').focus();
  await page.keyboard.press('Escape');
  assert.equal(await shell.locator('.dock').isVisible(), true);
  await shell.locator('.dock').click();
  checks.push('collapse, restore, keyboard focus and Escape work');

  await shell.locator('[data-field="model"]').fill('');
  await shell.locator('[data-action="save"]').click();
  await shell.evaluate(el => el.shadowRoot.activeElement?.blur());
  await page.evaluate(() => window.__cxdsUiTest.setStatus('等待开始'));
  await page.screenshot({ path: path.join(root, 'preview/桌面界面.png') });
  await shell.screenshot({ path: path.join(root, 'preview/新版界面.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const metrics = await shell.locator('.box').evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }; });
  assert(metrics.left >= 0 && metrics.right <= 390 && metrics.top >= 0 && metrics.bottom <= 844, 'Panel fits phone viewport');
  assert(metrics.scrollWidth <= metrics.clientWidth + 1, 'No horizontal overflow');
  await shell.locator('[data-action="stop"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, 'preview/手机宽度.png') });
  await page.setViewportSize({ width: 320, height: 568 });
  const small = await shell.locator('.box').boundingBox();
  assert(small.x >= 0 && small.y >= 0 && small.x + small.width <= 320 && small.y + small.height <= 568);
  await shell.locator('[data-action="start"]').scrollIntoViewIfNeeded();
  assert(await shell.locator('[data-action="start"]').isVisible());
  checks.push('390px and 320px viewports fit without horizontal overflow; commands remain reachable');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => { window.__cxdsUiTest.lock(true); window.__cxdsUiTest.setStatus('正在请求第 1 题'); });
  assert.equal(await shell.locator('.hero-art').evaluate(el => getComputedStyle(el).animationName), 'none');
  checks.push('reduced-motion preference is respected');
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  const assetMetadata = [];
  for (const key of ['welcome', 'thinking', 'rest', 'complete']) {
    const file = path.join(root, 'assets', `${key}.webp`);
    const info = await sharp(file).metadata();
    const stats = await sharp(file).stats();
    assert(info.hasAlpha && stats.channels[3].min === 0 && stats.channels[3].max > 0);
    assetMetadata.push({ key, width: info.width, height: info.height, hasAlpha: info.hasAlpha });
  }
  const report = { result: 'PASS', checks, errors, externalRequests: requests.length, phoneMetrics: metrics, assets: assetMetadata, limits: 'Local synthetic UI checks only; no live Chaoxing or paid API calls.' };
  fs.writeFileSync(path.join(root, 'preview/界面检查.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
