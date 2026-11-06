import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
const code = source.replace(hook, '  window.__multiTest = { diagnosticReport, run, stop };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const origin = 'https://mooc1.chaoxing.com';
const workPath = '/mooc-ans/work/doHomeWorkNew';
const checks = [], errors = [];

async function setup(options = {}) {
  const context = await browser.newContext();
  const requests = [];
  await context.exposeBinding('__recordModel', (_source, request) => requests.push(request));
  await context.addInitScript(() => {
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'offline-model', delayMs: 0, autoNext: true, autoSubmit: false });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      window.__recordModel(JSON.parse(request.data));
      const reply = () => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: ['A'], needs_review: false }) } }] }) });
      if (window.__hold) window.__reply = reply; else setTimeout(reply, 0);
      return { abort() { request.onabort(); } };
    };
  });
  const attachment = (id, extra = '') => `<div class="ans-attach-ct"><iframe id="${id}" jobid="work-${id}" ${extra} src="/ananas/modules/work/index.html?work=${id}"></iframe></div>`;
  let topReloaded = false;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    let body;
    if (url.pathname === '/fixture-script.js') return route.fulfill({ contentType: 'text/javascript', body: code });
    if (url.pathname === '/mycourse/studentstudy') {
      if (url.searchParams.has('resume')) topReloaded = true;
      body = options.generic
      ? `<iframe id="one" src="${workPath}?workId=one"></iframe><iframe id="two" src="${workPath}?workId=two"></iframe>`
      : '<iframe id="chapter" src="/mooc-ans/knowledge/cards"></iframe>';
    }
    else if (url.pathname === '/mooc-ans/knowledge/cards') body = attachment('one') + (options.single ? '' : attachment('two')) + attachment('hidden', 'hidden');
    else if (url.pathname === '/ananas/modules/work/index.html') body = `<iframe id="work" src="${workPath}?workId=${url.searchParams.get('work')}"></iframe>`;
    else if (url.pathname === workPath) {
      const id = url.searchParams.get('workId');
      if (options.topReload && topReloaded && id === 'two') await new Promise(resolve => setTimeout(resolve, 250));
      if (options.paginate && url.searchParams.has('start')) await new Promise(resolve => setTimeout(resolve, 250));
      const index = options.topReload && topReloaded && id === 'two' ? 1 : Number(url.searchParams.get('start') || 0);
      const count = options.paginate ? 1 : id === 'one' ? 12 : 3;
      const questions = Array.from({ length: count }, (_, number) => `<section class="questionLi"><h3 class="mark_name">${number + index + 1}. 单选题：虚构测验 ${id}</h3>
        <input type="hidden" name="type${101 + number + index}" value="0">
        <label><input type="radio" name="answer${101 + number + index}" value="A">A. 虚构甲</label>
        <label><input type="radio" name="answer${101 + number + index}" value="B">B. 虚构乙</label></section>`).join('');
      const nextTarget = options.topReload ? "top.location.href='/mycourse/studentstudy?resume=1'" : `location.href='${workPath}?workId=${options.switchTask ? 'different' : id}&start=1'`;
      const next = options.paginate && id === 'two' && index === 0 ? `<a id="next" onclick="${nextTarget}">下一题</a>` : '';
      body = questions + next;
    } else return route.abort();
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: body + '<script src="/fixture-script.js"></script>' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/mycourse/studentstudy');
  await page.locator('#cxds-panel [data-action=start]').waitFor();
  if (!options.single) await page.waitForFunction(() => document.querySelector('#cxds-panel')?.shadowRoot.querySelector('[data-field=questionDocument]')?.options.length === 3);
  const work = id => page.frames().find(frame => new URL(frame.url()).pathname === workPath && new URL(frame.url()).searchParams.get('workId') === id);
  return { context, page, work, requests };
}

const status = test => test.page.locator('#cxds-panel [data-role=status]');
const select = test => test.page.locator('#cxds-panel [data-field=questionDocument]');
async function run(test) {
  await test.page.evaluate(() => window.__multiTest.run());
  assert.match(await status(test).textContent(), /填答完成/);
}

try {
  let test = await setup();
  let report = await test.page.evaluate(() => window.__multiTest.diagnosticReport());
  assert.equal(report.questionCount, 15);
  assert.deepEqual(report.documents.filter(doc => doc.questionCount).map(doc => doc.questionCount), [12, 3]);
  assert.equal(report.documents.filter(doc => doc.selected).length, 1);
  assert(report.documents.filter(doc => doc.questionCount).every(doc => doc.chapterWork));
  assert.equal(await select(test).inputValue(), '0');
  assert.equal(await select(test).isVisible(), true);
  assert.deepEqual(await select(test).locator('option').allTextContents(), ['请选择本次要填写的测验', '测验 1（12 题）', '测验 2（3 题）']);
  assert(!JSON.stringify(report).includes('offline-fixture-key'));
  assert(!JSON.stringify(report).includes('workId='));
  checks.push('same-chapter 12+3 work frames are recognized as separate selectable tests; hidden attachments excluded and diagnostics redacted');
  await test.page.setViewportSize({ width: 1280, height: 1000 });
  await test.page.screenshot({ path: path.join(root, 'preview/多测验界面.png') });
  await test.page.setViewportSize({ width: 390, height: 844 });
  await select(test).scrollIntoViewIfNeeded();
  const scopeBounds = await select(test).boundingBox();
  assert(scopeBounds.x >= 0 && scopeBounds.x + scopeBounds.width <= 390);
  assert(scopeBounds.y >= 0 && scopeBounds.y + scopeBounds.height <= 844);
  assert.equal(await test.page.locator('#cxds-panel [data-action=start]').isVisible(), true);
  await test.page.screenshot({ path: path.join(root, 'preview/多测验手机界面.png') });
  checks.push('the multi-test selector fits the desktop and 390px phone layout with commands visible');
  await run(test);
  assert.equal(test.requests.length, 12);
  assert.equal(await test.work('one').locator('input:checked').count(), 12);
  assert.equal(await test.work('two').locator('input:checked').count(), 0);
  checks.push('default first chapter test fills only its 12 questions and leaves the sibling test untouched');
  await select(test).selectOption('1');
  await run(test);
  assert.equal(test.requests.length, 15);
  assert.equal(await test.work('two').locator('input:checked').count(), 3);
  checks.push('selecting the second test fills its three questions independently despite reused question numbers and IDs');
  await test.context.close();

  test = await setup({ generic: true });
  await test.page.evaluate(() => window.__multiTest.run());
  assert.match(await status(test).textContent(), /多个答题页面.*答题范围/);
  assert.equal(test.requests.length, 0);
  assert.equal(await select(test).inputValue(), '');
  await select(test).selectOption('1');
  await run(test);
  assert.equal(test.requests.length, 3);
  assert.equal(await test.work('one').locator('input:checked').count(), 0);
  checks.push('unrelated simultaneous work documents require an explicit choice; the selected document alone is filled');
  await test.context.close();

  test = await setup();
  await select(test).selectOption('1');
  await test.page.evaluate(() => { window.__hold = true; window.__pending = window.__multiTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  assert.equal(await select(test).isDisabled(), true);
  await test.work('one').locator('input[type=radio]').first().focus();
  await test.page.evaluate(() => { window.__hold = false; window.__reply(); return window.__pending; });
  assert.equal(await test.work('two').locator('input:checked').count(), 3);
  assert.equal(await test.work('one').locator('input:checked').count(), 0);
  assert.equal(await select(test).isEnabled(), true);
  checks.push('selection is locked while running and a focus change cannot redirect pending answers');
  await test.context.close();

  test = await setup({ paginate: true });
  await select(test).selectOption('1');
  await run(test);
  assert.equal(test.requests.length, 2);
  assert.equal(await test.work('one').locator('input:checked').count(), 0);
  assert.equal(await test.work('two').locator('input:checked').count(), 1);
  assert.equal(await select(test).inputValue(), '1');
  checks.push('a selected sibling iframe can reload for the next question without switching to the first test');
  await test.context.close();

  test = await setup({ paginate: true, topReload: true });
  await select(test).selectOption('1');
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await test.page.waitForURL(url => url.searchParams.has('resume'));
  await test.page.waitForFunction(() => /填答完成|续答完成|已暂停/.test(document.querySelector('#cxds-panel')?.shadowRoot.querySelector('[data-role=status]')?.textContent || ''));
  assert.match(await status(test).textContent(), /续答完成/);
  assert.equal(test.requests.length, 2);
  assert.equal(await test.work('one').locator('input:checked').count(), 0);
  assert.equal(await test.work('two').locator('input:checked').count(), 1);
  report = await test.page.evaluate(() => window.__multiTest.diagnosticReport());
  assert.equal(report.documents.filter(doc => doc.questionCount).findIndex(doc => doc.selected), 1);
  checks.push('a complete wrapper reload resumes the second test by its task scope instead of the default first test');
  await test.context.close();

  test = await setup({ paginate: true, switchTask: true });
  await select(test).selectOption('1');
  await test.page.evaluate(() => window.__multiTest.run());
  assert.match(await status(test).textContent(), /离开原答题任务/);
  assert.equal(test.requests.length, 1);
  assert.equal(await test.work('different').locator('input:checked').count(), 0);
  checks.push('navigation from the selected frame to a different task pauses before answering that task');
  await test.context.close();

  test = await setup();
  await select(test).selectOption('1');
  await test.page.evaluate(() => { window.__hold = true; window.__pending = window.__multiTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  await test.work('two').parentFrame().evaluate(() => document.querySelector('#work').remove());
  await test.page.evaluate(() => { window.__reply(); return window.__pending; });
  assert.match(await status(test).textContent(), /作业页面已切换/);
  assert.equal(test.requests.length, 1);
  assert.equal(await test.work('one').locator('input:checked').count(), 0);
  checks.push('removing the selected work frame during a model request cannot redirect its answer into the remaining test');
  await test.context.close();

  test = await setup({ single: true });
  assert.equal(await select(test).isVisible(), false);
  checks.push('a single work document keeps the extra scope control hidden');
  await test.context.close();

  test = await setup();
  await select(test).selectOption('1');
  await test.page.evaluate(() => { window.__hold = true; window.__pending = window.__multiTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  await test.page.locator('#cxds-panel [data-action=stop]').click();
  await test.page.evaluate(() => window.__pending);
  assert.equal(await status(test).textContent(), '手动暂停');
  assert.equal(await select(test).isEnabled(), true);
  assert.equal(await test.work('one').locator('input:checked').count(), 0);
  assert.equal(await test.work('two').locator('input:checked').count(), 0);
  checks.push('manual pause cancels the selected test request and unlocks the scope control without filling either test');
  await test.context.close();

  assert.deepEqual(errors, []);
  const reportOut = { result: 'PASS', checks, browserErrors: errors, network: 'Fictional fixtures only; model API mocked and all other requests blocked.' };
  fs.writeFileSync(path.join(root, 'preview/多测验检查.json'), JSON.stringify(reportOut, null, 2) + '\n');
  console.log(JSON.stringify(reportOut, null, 2));
} finally {
  await browser.close();
}
