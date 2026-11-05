import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
const code = source.replace(hook, '  window.__shortcutTest = { diagnosticReport };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [], errors = [];
const taskPath = '/exam-ans/exam/test/reVersionTestStartNew';
const fixture = '<section class="questionLi"><h3 class="mark_name">1. 简答题：虚构练习</h3><input type="hidden" name="type101" value="4"><textarea id="answer"></textarea></section>';

async function setup(options = {}) {
  const context = await browser.newContext();
  await context.addInitScript(options => {
    window.__requests = [];
    window.__aborts = 0;
    window.__menus = [];
    window.__hold = !!options.hold;
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'offline-model', autoNext: true, autoSubmit: false, delayMs: 0 });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = (name, callback) => window.__menus.push({ name, callback });
    window.GM_xmlhttpRequest = request => {
      const number = window.__requests.push(JSON.parse(request.data));
      let cancelled = false;
      const reply = () => {
        if (cancelled) return;
        if (options.change && number === 1) document.querySelector('.mark_name').append(' 已更新');
        request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: ['答案' + number], needs_review: false }) } }] }) });
      };
      window.__reply = reply;
      if (!window.__hold) setTimeout(reply, 10);
      return { abort() { cancelled = true; window.__aborts++; request.onabort(); } };
    };
  }, options);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/controller.js') return route.fulfill({ contentType: 'text/javascript', body: code });
    if (url.pathname === '/editor') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: '<body contenteditable="true"><p>虚构编辑区</p></body>' });
    if (url.pathname === '/mycourse/studentstudy') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<iframe id="work" src="${taskPath}"></iframe><script src="/controller.js"></script>` });
    if (url.pathname !== taskPath) return route.abort();
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<!doctype html><style>body{background:#f5f5f5}textarea{width:200px;height:60px}</style>${fixture}<script src="/controller.js"></script>` });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://mooc1.chaoxing.com' + (options.wrapped ? '/mycourse/studentstudy' : taskPath));
  await page.locator('#cxds-panel').waitFor();
  const work = page.frames().find(frame => new URL(frame.url()).pathname === taskPath);
  return { context, page, work, shell: page.locator('#cxds-panel') };
}
async function waitStatus(test, pattern) {
  await test.page.waitForFunction(text => new RegExp(text).test(document.querySelector('#cxds-panel').shadowRoot.querySelector('[data-role=status]').textContent), pattern.source);
}
async function hidden(test, value = true) {
  assert.equal(await test.shell.isVisible(), !value);
  assert.equal(await test.shell.evaluate(host => host.hidden && host.inert && getComputedStyle(host).display === 'none'), value);
  if (value) {
    assert.equal(await test.shell.locator('.box').isVisible(), false);
    assert.equal(await test.shell.locator('.dock').isVisible(), false);
    assert.equal(await test.shell.boundingBox(), null);
  }
}

try {
  let test = await setup();
  await test.page.keyboard.press('Alt+q');
  await hidden(test);
  assert.equal(await test.shell.getAttribute('aria-hidden'), 'true');
  assert.equal(await test.page.evaluate(() => window.__shortcutTest.diagnosticReport().interfaceHidden), true);
  await test.page.keyboard.press('Alt+q');
  await hidden(test, false);
  assert.equal(await test.shell.locator('.box').isVisible(), true);
  checks.push('Alt+Q removes the whole host from rendering and focus, including the dock, then restores it');
  await test.context.close();

  test = await setup();
  await test.shell.locator('.collapse').click();
  await test.page.keyboard.press('Alt+q');
  await hidden(test);
  await test.page.keyboard.press('Alt+q');
  assert.equal(await test.shell.locator('.dock').isVisible(), true);
  assert.equal(await test.shell.locator('.box').isVisible(), false);
  checks.push('full hide/show preserves the previous collapsed state');
  await test.context.close();

  test = await setup({ hold: true });
  await test.page.keyboard.press('Alt+q');
  await test.page.keyboard.press('Alt+w');
  await test.page.waitForFunction(() => window.__requests.length === 1);
  await hidden(test);
  await test.page.keyboard.press('Alt+w');
  await waitStatus(test, /手动暂停/);
  assert.equal(await test.page.evaluate(() => window.__aborts), 1);
  await test.page.evaluate(() => window.__reply());
  assert.equal(await test.work.locator('#answer').inputValue(), '');
  await test.page.keyboard.press('Alt+w');
  await test.page.waitForFunction(() => window.__requests.length === 2);
  await test.page.evaluate(() => window.__reply());
  await waitStatus(test, /填答完成/);
  assert.equal(await test.work.locator('#answer').inputValue(), '答案2');
  await hidden(test);
  checks.push('Alt+W starts, aborts and restarts while fully hidden without allowing a late answer write');
  await test.context.close();

  test = await setup();
  await test.work.locator('#answer').focus();
  await test.page.keyboard.type('qwQW');
  assert.equal(await test.work.locator('#answer').inputValue(), 'qwQW');
  const ignored = await test.page.evaluate(() => [
    { code: 'KeyQ' }, { code: 'KeyW' }, { code: 'KeyQ', ctrlKey: true },
    { code: 'KeyQ', altKey: true, shiftKey: true }, { code: 'KeyW', altKey: true, ctrlKey: true },
    { code: 'KeyQ', altKey: true, metaKey: true }, { code: 'KeyQ', altKey: true, isComposing: true },
    { code: 'KeyQ', altKey: true, modifierAltGraph: true }, { code: 'KeyE', altKey: true }
  ].map(init => { const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); document.dispatchEvent(event); return event.defaultPrevented; }));
  assert(ignored.every(value => !value));
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  await hidden(test, false);
  checks.push('ordinary typing, other shortcuts, composing text and AltGraph remain untouched');
  await test.context.close();

  test = await setup({ hold: true });
  const repeated = await test.page.evaluate(() => ['KeyQ', 'KeyW'].map(code => { const event = new KeyboardEvent('keydown', { code, altKey: true, repeat: true, bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented; }));
  assert.deepEqual(repeated, [true, true]);
  await hidden(test, false);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('holding a shortcut key does not repeatedly toggle visibility or start/pause');
  await test.context.close();

  test = await setup({ wrapped: true, hold: true });
  await test.work.locator('#answer').focus();
  await test.page.keyboard.press('Alt+q');
  await hidden(test);
  await test.page.keyboard.press('Alt+w');
  await test.page.waitForFunction(() => window.__requests.length === 1);
  await test.page.keyboard.press('Alt+w');
  await waitStatus(test, /手动暂停/);
  await hidden(test);
  checks.push('shortcuts work when focus is inside a question iframe');
  await test.context.close();

  test = await setup({ wrapped: true });
  await test.work.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'editor'; frame.src = '/editor'; document.body.append(frame); });
  await test.work.waitForFunction(() => document.querySelector('#editor')?.contentDocument?.body?.isContentEditable);
  const editorFrame = test.page.frames().find(frame => new URL(frame.url()).pathname === '/editor');
  assert(editorFrame);
  await editorFrame.locator('body').focus();
  await test.page.keyboard.press('Alt+q');
  await hidden(test);
  await test.page.keyboard.press('Alt+q');
  await editorFrame.goto('https://mooc1.chaoxing.com/editor?reloaded=1');
  await editorFrame.locator('body').focus();
  await test.page.keyboard.press('Alt+q');
  await hidden(test);
  checks.push('new and reloaded nested rich-text iframe documents receive shortcut handlers');
  await test.context.close();

  test = await setup();
  await test.shell.locator('[data-field=model]').focus();
  await test.page.keyboard.press('Alt+q');
  assert.equal(await test.shell.evaluate(host => host.shadowRoot.activeElement), null);
  await test.page.keyboard.press('Alt+q');
  assert.equal(await test.shell.locator('.box').isVisible(), true);
  checks.push('hiding from a focused panel input clears hidden focus and keeps restoration available');
  await test.context.close();

  test = await setup();
  await test.page.keyboard.press('Alt+q');
  await test.page.reload();
  await test.page.waitForFunction(() => !!document.querySelector('#cxds-panel')?.shadowRoot?.querySelector('[data-role=status]'));
  await hidden(test);
  await test.page.keyboard.press('Alt+q');
  await hidden(test, false);
  assert.equal(await test.page.evaluate(() => sessionStorage.getItem('cxds.visibility.v1')), null);
  checks.push('full hide persists across document reloads in the same tab and is cleared on restore');
  await test.context.close();

  test = await setup();
  await test.page.keyboard.press('Alt+q');
  await test.page.evaluate(() => window.__menus[0].callback());
  await hidden(test, false);
  checks.push('the userscript menu can also restore a completely hidden interface');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__pageKeys = []; document.addEventListener('keydown', event => window.__pageKeys.push(event.code)); });
  await test.page.keyboard.press('Alt+q');
  const keys = await test.page.evaluate(() => window.__pageKeys);
  assert(!keys.includes('KeyQ'));
  assert(keys.includes('AltLeft'));
  checks.push('only recognized shortcut presses stop page propagation; other keyboard events still reach the page');
  await test.context.close();

  test = await setup({ change: true });
  await test.page.keyboard.press('Alt+q');
  await test.page.keyboard.press('Alt+w');
  await waitStatus(test, /自动重试/);
  await test.page.keyboard.press('Alt+w');
  await waitStatus(test, /手动暂停/);
  await test.page.waitForTimeout(250);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 1);
  await hidden(test);
  checks.push('the hidden pause shortcut cancels page-change retry backoff');
  await test.context.close();

  assert.deepEqual(errors, []);
  const report = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional browser/iframe fixtures with mocked model API. System-wide remappings and third-party extension shortcuts are outside this browser test.' };
  fs.writeFileSync(path.join(root, 'preview/快捷键检查.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
