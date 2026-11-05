import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
const code = source.replace(hook, '  window.__retryTest = { run, stop, diagnosticReport };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [], errors = [];
const taskPath = '/exam-ans/exam/test/reVersionTestStartNew';
const question = (number = 1, editor = false) => `<section class="questionLi"><h3 class="mark_name">${number}. 简答题：虚构练习</h3><input type="hidden" name="type${100 + number}" value="4">${editor ? '<div class="edui-editor"><iframe></iframe></div>' : `<textarea id="text${number}"></textarea>`}</section>`;
const vector = '<section class="questionLi"><h3 class="mark_name">1. 单选题：虚构图形</h3><input type="hidden" name="type101" value="0"><input type="hidden" id="answer101"><div class="answerBg" onclick="choose(this)"><span class="num_option" data="A">A</span><div class="answer_p"><svg xmlns="http://www.w3.org/2000/svg" width="80" height="30" viewBox="0 0 80 30"><rect width="30" height="15"/></svg></div></div><div class="answerBg" onclick="choose(this)"><span class="num_option" data="B">B</span><div class="answer_p">虚构选项乙</div></div></section>';

async function setup(body = question(), options = {}) {
  const context = await browser.newContext();
  await context.addInitScript(options => {
    window.unsafeWindow = window;
    window.__requests = [];
    window.__writes = [];
    window.__nextClicks = 0;
    window.__editorSets = 0;
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'deepseek-flash', autoNext: options.autoNext !== false, autoSubmit: false, delayMs: 0 });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      const data = JSON.parse(request.data), number = window.__requests.push(data);
      let cancelled = false;
      setTimeout(() => {
        if (cancelled) return;
        window.__beforeReply?.(number);
        if (window.__apiFail) return request.onerror();
        const content = data.messages[1].content;
        const type = JSON.parse(Array.isArray(content) ? content[0].text : content).type;
        const answer = type === 'text' ? '第' + number + '轮答案' : number === 1 ? 'A' : 'B';
        request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: [answer], needs_review: !!window.__review }) } }] }) });
      }, 20);
      return { abort() { cancelled = true; request.onabort(); } };
    };
  }, options);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mycourse/studentstudy') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<iframe id="work" src="${taskPath}?courseId=fixture-A"></iframe>` });
    if (url.pathname !== taskPath) return route.abort();
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<form>${body}</form><script>
      document.addEventListener('input', event => window.__writes.push(event.target.value));
      function choose(option) { for (const marker of document.querySelectorAll('.num_option')) marker.classList.remove('check_answer'); option.querySelector('.num_option').classList.add('check_answer'); document.querySelector('#answer101').value = option.querySelector('.num_option').getAttribute('data'); window.__writes.push(document.querySelector('#answer101').value); }
      function initEditors() {
        window.UE = { instants: {} };
        for (const [index, frame] of [...document.querySelectorAll('.edui-editor iframe')].entries()) {
          const doc = frame.contentDocument; doc.open(); doc.write('<body contenteditable="true"><p></p></body>'); doc.close();
          const backing = document.createElement('textarea'); backing.name = 'answerEditor' + index; backing.style.display = 'none'; frame.parentElement.append(backing);
          window.UE.instants['editor' + index] = { iframe: frame, body: doc.body, isReady: 1, textarea: backing, options: { textarea: backing.name }, setContent(html) { window.__editorSets++; doc.body.innerHTML = html; }, getContent() { return doc.body.innerHTML; }, sync() { backing.value = this.getContent(); } };
        }
      }
      initEditors();
      </script>` });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://mooc1.chaoxing.com' + (options.wrapped ? '/mycourse/studentstudy' : taskPath + '?courseId=fixture-A'));
  const work = page.frames().find(frame => new URL(frame.url()).pathname === taskPath);
  await page.addScriptTag({ content: code });
  // In wrapped cases the controller and API live outside the question document.
  if (options.wrapped) {
    await page.evaluate(() => {
      window.__beforeReply = number => {
        const doc = document.querySelector('#work').contentDocument;
        if (number === 1) doc.querySelector('.mark_name').append(' 已更新');
      };
    });
  }
  return { context, page, work };
}

async function run(test, expected = /填答完成/) {
  await test.page.evaluate(() => window.__retryTest.run());
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), expected);
}
const count = test => test.page.evaluate(() => window.__requests.length);
const log = test => test.page.locator('#cxds-panel [data-role=log]').textContent();
async function changeOnce(test) {
  await test.page.evaluate(() => { window.__beforeReply = number => { if (number === 1) document.querySelector('.mark_name').append(' 已更新'); }; });
}
async function waitRetry(test) {
  await test.page.waitForFunction(() => document.querySelector('#cxds-panel').shadowRoot.querySelector('[data-role=status]').textContent.includes('自动重试'));
}

try {
  let test = await setup();
  await changeOnce(test);
  await run(test);
  assert.equal(await count(test), 2);
  assert.equal(await test.work.locator('#text1').inputValue(), '第2轮答案');
  assert.deepEqual(await test.work.evaluate(() => window.__writes), ['第2轮答案']);
  assert((await test.page.evaluate(() => window.__requests[1].messages[1].content)).includes('已更新'));
  assert.equal(await test.page.evaluate(() => window.__retryTest.diagnosticReport().pageChangeRetryLimit), 3);
  checks.push('changed text discards the first result, re-reads the same question and fills only a newly requested answer');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__beforeReply = number => { if (number === 1) { const old = document.querySelector('.questionLi'); old.replaceWith(old.cloneNode(true)); } }; });
  await run(test);
  assert.equal(await count(test), 2);
  assert.equal(await test.work.locator('#text1').inputValue(), '第2轮答案');
  checks.push('replacing a question root reacquires the same identifier without writing the old answer');
  await test.context.close();

  test = await setup(question(1, true));
  await test.page.evaluate(() => { window.__beforeReply = number => { if (number === 1) { const old = document.querySelector('.questionLi'); old.replaceWith(old.cloneNode(true)); document.querySelector('.edui-editor textarea')?.remove(); initEditors(); } }; });
  await run(test);
  assert.equal(await count(test), 2);
  assert.equal(await test.work.evaluate(() => window.__editorSets), 1);
  assert.match(await test.work.locator('textarea').inputValue(), /第2轮答案/);
  checks.push('UEditor root replacement retries against the new instance and synchronizes its backing field once');
  await test.context.close();

  test = await setup(question(), { wrapped: true });
  await run(test);
  assert.equal(await count(test), 2);
  assert.equal(await test.work.locator('#text1').inputValue(), '第2轮答案');
  checks.push('a surviving controller retries changes inside the question iframe');
  await test.context.close();

  test = await setup(vector);
  await test.work.evaluate(() => {
    const decode = Image.prototype.decode;
    Image.prototype.decode = async function () { await decode.call(this); if (!window.__changed && this.src.startsWith('blob:')) { window.__changed = true; document.querySelector('rect').setAttribute('width', '65'); } };
  });
  await run(test);
  assert.equal(await count(test), 1);
  assert.match(await log(test), /自动重试/);
  checks.push('a formula change during image preparation retries before sending any stale model request');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__beforeReply = number => document.querySelector('.mark_name').append(' 变动' + number); });
  await run(test, /已自动重试 3 次/);
  assert.equal(await count(test), 4);
  assert.equal(await test.work.locator('#text1').inputValue(), '');
  assert.equal(await test.page.locator('#cxds-panel [data-action=start]').isEnabled(), true);
  checks.push('persistent changes stop after exactly three retries, with no text writes and the start button unlocked');
  await test.context.close();

  test = await setup();
  await changeOnce(test);
  await test.page.evaluate(() => { window.__pending = window.__retryTest.run(); });
  await waitRetry(test);
  await test.page.evaluate(() => window.__retryTest.stop());
  await test.page.evaluate(() => window.__pending);
  assert.equal(await count(test), 1);
  assert.equal(await test.page.locator('#cxds-panel [data-role=status]').textContent(), '手动暂停');
  assert.equal(await test.work.locator('#text1').inputValue(), '');
  checks.push('manual pause during retry backoff prevents another request and preserves paused status');
  await test.context.close();

  test = await setup();
  await changeOnce(test);
  await test.page.evaluate(() => { window.__pending = window.__retryTest.run(); });
  await waitRetry(test);
  await test.work.evaluate(() => history.replaceState(null, '', '?courseId=fixture-B'));
  await test.page.evaluate(() => window.__pending);
  assert.equal(await count(test), 1);
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), /任务已切换/);
  checks.push('changing the task during retry prevents a new model request or old answer write');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__beforeReply = number => { if (number === 1) { document.querySelector('input[name=type101]').name = 'type102'; document.querySelector('.mark_name').textContent = '2. 简答题：另一道虚构题'; } }; });
  await run(test, /原题未加载稳定或已切换/);
  assert.equal(await count(test), 1);
  assert.equal(await test.work.locator('#text1').inputValue(), '');
  checks.push('a different question identifier is never substituted for the original retry target');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__review = true; });
  await run(test, /人工检查/);
  assert.equal(await count(test), 1);
  assert.doesNotMatch(await log(test), /自动重试/);
  checks.push('model uncertainty keeps its existing pause behavior and is not retried');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__apiFail = true; });
  await run(test, /网络|请求/);
  assert.equal(await count(test), 1);
  assert.doesNotMatch(await log(test), /自动重试/);
  checks.push('unrelated API errors are not included in page-change retries');
  await test.context.close();

  test = await setup();
  await test.work.evaluate(() => document.querySelector('textarea').addEventListener('input', event => { event.target.value = ''; }));
  await run(test, /页面未确认填答状态/);
  assert.equal(await count(test), 1);
  checks.push('failed answer verification after a write pauses without repeating the write');
  await test.context.close();

  test = await setup(question(1) + question(2));
  await test.page.evaluate(() => { window.__beforeReply = number => { if (number === 1 || number === 3) document.querySelectorAll('.mark_name')[number === 1 ? 0 : 1].append(' 已更新'); }; });
  await run(test);
  assert.equal(await count(test), 4);
  assert.equal(await test.work.locator('#text1').inputValue(), '第2轮答案');
  assert.equal(await test.work.locator('#text2').inputValue(), '第4轮答案');
  assert.match(await log(test), /已填写 2 题/);
  checks.push('retry counters reset for each question while progress counts only successfully filled questions');
  await test.context.close();

  test = await setup(question() + '<button type="button" onclick="window.__nextClicks++">下一题</button>');
  await changeOnce(test);
  await run(test, /翻页后题目未变化/);
  assert.equal(await count(test), 2);
  assert.equal(await test.work.evaluate(() => window.__nextClicks), 1);
  assert.equal(await test.page.evaluate(() => sessionStorage.getItem('cxds.navigation.v1')), null);
  checks.push('navigation compares the retried snapshot and still detects an unchanged page after a failed next action');
  await test.context.close();

  assert.deepEqual(errors, []);
  const report = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional text, UEditor interface and SVG fixtures with local mocked API. No real course page, paid API or server save.' };
  fs.writeFileSync(path.join(root, 'preview/页面变化重试检查.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
