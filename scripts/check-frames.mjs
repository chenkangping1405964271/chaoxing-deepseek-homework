import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
assert(!source.includes('__cxdsFrameTest'));
const instrumented = source.replace(hook, '  window.__cxdsFrameTest = { roots, parseQuestion, diagnosticReport, run, stop };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge, 'Microsoft Edge is required');
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [];
const errors = [];
const origin = 'https://mooc1.chaoxing.com';
const workPath = '/mooc-ans/work/doHomeWorkNew';
const legacy = (number = 1, encrypted = false) => `<div class="TiMu newTiMu">
  <div class="Zy_TItle clearfix"><i>${number}</i><div class="clearfix ${encrypted ? 'font-cxsecret' : ''}">【判断题】鲸鱼是哺乳动物。</div></div>
  <ul class="Zy_ulTop"><li role="radio"><label><span class="num_option">A</span></label><a class="fl after">对</a></li>
  <li role="radio"><label><span class="num_option">B</span></label><a class="fl after">错</a></li></ul>
  <input type="hidden" id="answer${number}"><input type="hidden" id="answertype${number}" value="3"></div>`;
const handlers = `<script>document.addEventListener('click',e=>{const li=e.target.closest('.Zy_ulTop > li');if(!li)return;
  const q=li.closest('.TiMu');for(const other of q.querySelectorAll('li')){other.setAttribute('aria-checked',String(other===li));other.querySelector('span').classList.toggle('check_answer',other===li);}
  q.querySelector('input[id^="answer"]').value=li.textContent.trim().startsWith('A')?'true':'false';});</script>`;

async function setup(work, extras = '', options = {}) {
  const context = await browser.newContext();
  await context.addInitScript(settings => {
    window.__requests = [];
    window.__hold = false;
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'offline-model', delayMs: 0, autoNext: true, autoSubmit: false, ...settings });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      window.__requests.push(JSON.parse(request.data));
      const reply = () => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: ['A'], needs_review: false }) } }] }) });
      if (window.__hold) window.__reply = reply;
      else setTimeout(reply, 0);
      return { abort() { request.onabort(); } };
    };
  }, options);
  const routes = new Map([
    ['/mycourse/studentstudy', `<button onclick="window.outerNext=true">下一页</button><button onclick="window.outerSubmit=true">提交</button><iframe id="iframe" src="/mooc-ans/knowledge/cards"></iframe>${extras}`],
    ['/mooc-ans/knowledge/cards', '<iframe src="/ananas/modules/work/index.html"></iframe>'],
    ['/ananas/modules/work/index.html', `<iframe id="frame_content" src="${workPath}"></iframe>`],
    [workPath, work + handlers],
    ['/exam/test', legacy()],
    ['/hidden', legacy()],
    ['/second', legacy(2)]
  ]);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && routes.has(url.pathname)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: routes.get(url.pathname) });
    if (url.hostname === 'other.chaoxing.com') return route.fulfill({ contentType: 'text/html', body: '<p>Separate origin fixture</p>' });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/mycourse/studentstudy?private=DO_NOT_EXPORT');
  for (const frame of page.frames()) {
    if (new URL(frame.url()).origin === origin) await frame.evaluate(code => (0, eval)(code), instrumented);
  }
  return { context, page, work: page.frames().find(frame => new URL(frame.url()).pathname === workPath) };
}

try {
  let test = await setup(Array.from({ length: 10 }, (_, i) => legacy(i + 1, true)).join(''), '<iframe hidden src="/hidden"></iframe><iframe hidden src="/exam/test"></iframe><iframe src="https://other.chaoxing.com/quiz?private=DO_NOT_EXPORT"></iframe>');
  const report = await test.page.evaluate(() => window.__cxdsFrameTest.diagnosticReport());
  assert.equal(report.questionCount, 10);
  assert.equal(report.documentCount, 4);
  assert(report.questions.every(q => q.encryptedFont && q.choiceElements === 2 && q.hasTypeInput));
  assert(report.frames.some(frame => !frame.accessible));
  assert(!JSON.stringify(report).includes('DO_NOT_EXPORT'));
  assert(!JSON.stringify(report).includes('鲸鱼'));
  assert(!JSON.stringify(report).includes('offline-fixture-key'));
  const panels = await Promise.all(test.page.frames().map(frame => frame.locator('#cxds-panel').count()));
  assert.equal(panels.reduce((a, b) => a + b, 0), 1);
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.match(await test.page.locator('#cxds-panel [data-role="status"]').textContent(), /加密字体样式尚未加载/);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('three iframe layers: 10 encrypted questions found; one panel; hidden frames excluded; absent font pauses before model request; diagnostic redacted');
  await test.context.close();

  test = await setup(legacy());
  const parsed = await test.page.evaluate(() => { const q = window.__cxdsFrameTest.parseQuestion(window.__cxdsFrameTest.roots()[0]); return { number: q.number, id: q.id, type: q.type, choices: q.choices.map(c => c.text) }; });
  assert.deepEqual(parsed, { number: 1, id: '1', type: 'judge', choices: ['对', '错'] });
  await test.work.evaluate(() => document.querySelector('.Zy_TItle .clearfix').insertAdjacentHTML('beforeend', '<img src="./formula.png">'));
  assert.equal(await test.page.evaluate(() => window.__cxdsFrameTest.parseQuestion(window.__cxdsFrameTest.roots()[0]).images[0].src), origin + '/mooc-ans/work/formula.png');
  await test.work.locator('.Zy_TItle img').evaluate(el => el.remove());
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.equal(await test.work.locator('#answer1').inputValue(), 'true', await test.page.locator('#cxds-panel [data-role="status"]').textContent());
  assert.match(await test.page.locator('#cxds-panel [data-role="status"]').textContent(), /填答完成/);
  assert.equal(await test.page.evaluate(() => !!window.outerNext || !!window.outerSubmit), false);
  checks.push('legacy question number/type/options and iframe-relative image URLs parsed; native option click updates hidden answer; outer navigation untouched');
  await test.context.close();

  const second = legacy(2).replaceAll('【判断题】', '【判断题】第二题：');
  test = await setup(legacy() + `<button id="next">下一题</button><script>document.querySelector('#next').onclick=()=>{document.querySelector('.TiMu').outerHTML=${JSON.stringify(second)};document.querySelector('#next').remove();}</script>`);
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.equal(await test.page.evaluate(() => window.__requests.length), 2);
  assert.equal(await test.work.locator('#answer2').inputValue(), 'true');
  assert.equal(await test.page.evaluate(() => !!window.outerNext), false);
  checks.push('next-question lookup and pagination stay inside the selected work document');
  await test.context.close();

  test = await setup(legacy() + '<button id="submit" onclick="window.didSubmit=true;document.querySelector(\'#confirm\').hidden=false">提交</button><div id="confirm" role="dialog" hidden>提交作业<button onclick="window.didConfirm=true">确定</button></div>', '', { autoSubmit: true, expectedTotal: 1 });
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.equal(await test.work.evaluate(() => window.didSubmit && window.didConfirm), true);
  assert.equal(await test.page.evaluate(() => !!window.outerSubmit), false);
  checks.push('optional submission and confirmation only target the selected work document');
  await test.context.close();

  test = await setup('');
  await test.work.evaluate(html => setTimeout(() => document.body.insertAdjacentHTML('afterbegin', html), 250), legacy());
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.equal(await test.work.locator('#answer1').inputValue(), 'true');
  checks.push('delayed iframe question rendering is awaited before recognition');
  await test.context.close();

  test = await setup('');
  await test.page.evaluate(() => { window.__cxdsPendingRun = window.__cxdsFrameTest.run(); });
  await test.page.evaluate(() => window.__cxdsFrameTest.stop());
  await test.page.evaluate(() => window.__cxdsPendingRun);
  assert.equal(await test.page.locator('#cxds-panel [data-role="status"]').textContent(), '手动暂停');
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('pause cancels the question-loading wait without making a model request');
  await test.context.close();

  test = await setup(legacy(), '<iframe src="/second"></iframe>');
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.match(await test.page.locator('#cxds-panel [data-role="status"]').textContent(), /多个答题页面.*答题范围/);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('ambiguous simultaneous work documents pause before requesting answers');
  await test.context.close();

  test = await setup(legacy());
  await test.page.evaluate(() => { window.__hold = true; window.__cxdsPendingRun = window.__cxdsFrameTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  await test.work.goto(origin + '/second');
  await test.page.evaluate(() => { window.__reply(); return window.__cxdsPendingRun; });
  assert.match(await test.page.locator('#cxds-panel [data-role="status"]').textContent(), /作业页面已切换/);
  assert.equal(await test.work.locator('#answer2').inputValue(), '');
  checks.push('iframe navigation during model request prevents stale-answer writes');
  await test.context.close();

  test = await setup('<div class="questionLi"><h3 class="mark_name">1. 简答题：写出字母 A</h3><textarea></textarea></div><script>window.inputEvents=[];document.querySelector("textarea").addEventListener("input",e=>inputEvents.push(e instanceof Event));document.querySelector("textarea").addEventListener("change",e=>inputEvents.push(e instanceof Event));</script>');
  await test.page.evaluate(() => window.__cxdsFrameTest.run());
  assert.equal(await test.work.locator('textarea').inputValue(), 'A');
  assert.deepEqual(await test.work.evaluate(() => window.inputEvents), [true, true]);
  checks.push('text fields receive input/change events created in their own iframe window');
  await test.context.close();

  await Promise.all([false, true].map(async blocked => {
    const empty = await setup('', blocked ? '<iframe src="https://other.chaoxing.com/quiz"></iframe>' : '');
    await empty.page.evaluate(() => window.__cxdsFrameTest.run());
    assert.match(await empty.page.locator('#cxds-panel [data-role="status"]').textContent(), blocked ? /iframe 无法访问/ : /作业题目尚未加载/);
    assert.equal(await empty.page.evaluate(() => window.__requests.length), 0);
    await empty.context.close();
  }));
  checks.push('loading times out with separate messages for empty pages and inaccessible iframe content');

  assert.deepEqual(errors, []);
  const testReport = { result: 'PASS', checks, browserErrors: errors, network: 'All URLs fulfilled locally or blocked; model API mocked.' };
  fs.writeFileSync(path.join(root, 'preview/题目识别检查.json'), JSON.stringify(testReport, null, 2) + '\n');
  console.log(JSON.stringify(testReport, null, 2));
} finally {
  await browser.close();
}
