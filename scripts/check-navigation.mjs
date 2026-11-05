import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
const code = source.replace(hook, '  window.__navigationTest = { diagnosticReport };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const origin = 'https://mooc1.chaoxing.com';
const examPath = '/exam-ans/exam/test/reVersionTestStartNew';
const storageKey = 'cxds.navigation.v1';
const checks = [], errors = [];

async function setup(options = {}) {
  const context = await browser.newContext();
  const requests = [], submissions = [], checkpoints = [];
  await context.exposeBinding('__modelFixture', ({ frame }, body) => {
    requests.push({ path: new URL(frame.url()).pathname, body });
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers: ['B'], needs_review: false }) } }] };
  });
  await context.exposeBinding('__submitFixture', () => submissions.push(true));
  await context.exposeBinding('__checkpointFixture', (_source, checkpoint) => checkpoints.push(checkpoint));
  await context.addInitScript(options => {
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'offline-model', delayMs: 0, autoNext: options.autoNext !== false, autoSubmit: true, expectedTotal: 1 });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      let cancelled = false;
      window.__modelFixture(JSON.parse(request.data)).then(result => {
        if (!cancelled) request.onload({ status: 200, responseText: JSON.stringify(result) });
      });
      return { abort() { cancelled = true; request.onabort(); } };
    };
  }, options);
  const taskPath = options.work ? '/work/fixture' : examPath;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture-script.js') return route.fulfill({ contentType: 'text/javascript', body: code });
    if (url.pathname === '/mycourse/studentstudy') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<button onclick="window.__submitFixture()">提交</button><iframe src="${taskPath}?start=0&courseId=fictional-A"></iframe><script src="/fixture-script.js"></script>` });
    if (url.pathname !== taskPath) return route.abort();
    const index = Number(url.searchParams.get('start') || 0);
    const number = options.repeat ? 1 : index + 1;
    const id = 100 + number;
    const nextCourse = options.switchTask ? 'fictional-B' : 'fictional-A';
    const target = taskPath + '?start=' + (index + 1) + '&courseId=' + nextCourse;
    const next = index < (options.lastIndex ?? 2) ? '<a id="next" onclick="getTheNextQuestion(1)">下一题</a>' : '';
    const body = `<section class="questionLi"><h3 class="mark_name">${number}. 单选题：虚构练习</h3><input type="hidden" name="type${id}" value="0"><input type="hidden" id="answer${id}" value="">
      <div class="answerBg" onclick="choose(this)"><span class="num_option" data="A">A</span><div class="answer_p">虚构选项甲</div></div>
      <div class="answerBg" onclick="choose(this)"><span class="num_option" data="B">B</span><div class="answer_p">虚构选项乙</div></div></section>${next}<button id="submit" onclick="window.__submitFixture()">提交</button>
      <script>
      function choose(option) {
        for (const marker of document.querySelectorAll('.num_option')) marker.classList.remove('check_answer');
        option.querySelector('.num_option').classList.add('check_answer');
        document.querySelector('#answer${id}').value = option.querySelector('.num_option').getAttribute('data');
      }
      function getTheNextQuestion() {
        const checkpoint = JSON.parse(sessionStorage.getItem('${storageKey}'));
        window.__checkpointFixture(checkpoint);
        if (${!!options.expired}) { checkpoint.expires = Date.now() - 1; sessionStorage.setItem('${storageKey}', JSON.stringify(checkpoint)); }
        if (${!!options.failedSave}) return;
        // Matches the page's save callback followed by a complete document navigation.
        setTimeout(() => { location.href = ${JSON.stringify(target)}; }, ${options.navigationDelay ?? 80});
      }
      </script><script src="/fixture-script.js"></script>`;
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + (options.wrapped ? '/mycourse/studentstudy' : taskPath + '?start=0&courseId=fictional-A'));
  await page.locator('#cxds-panel [data-action=start]').waitFor();
  return { context, page, requests, submissions, checkpoints, taskPath };
}

async function waitStatus(test, pattern, timeout = 10000) {
  await test.page.waitForFunction(text => {
    const status = document.querySelector('#cxds-panel')?.shadowRoot?.querySelector('[data-role=status]');
    return status && new RegExp(text).test(status.textContent);
  }, pattern.source, { timeout });
}

async function verifyComplete(test, total) {
  await waitStatus(test, /填答完成|跨页续答完成/);
  assert.equal(test.requests.length, total);
  assert.equal(test.submissions.length, 0);
  const work = test.page.frames().find(frame => new URL(frame.url()).pathname === test.taskPath);
  assert.equal(await work.locator('input[id^=answer]').inputValue(), 'B');
  assert.equal(await test.page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
  for (const checkpoint of test.checkpoints) {
    const text = JSON.stringify(checkpoint);
    assert(!text.includes('offline-fixture-key'));
    assert(!text.includes('虚构'));
    assert(!text.includes('fictional-A'));
    assert(checkpoint.pages.every(hash => /^[a-f0-9]{64}$/.test(hash)));
  }
}

try {
  let test = await setup();
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await verifyComplete(test, 3);
  assert.equal(test.checkpoints.length, 2);
  checks.push('three full exam page loads continue automatically after each save callback, without duplicate answers or hand-in');
  checks.push('per-tab continuation checkpoints contain only scope/page hashes, counters and expiry; no key, question text or raw task identifiers');
  await test.context.close();

  test = await setup({ wrapped: true });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await verifyComplete(test, 3);
  assert.equal((await Promise.all(test.page.frames().map(frame => frame.locator('#cxds-panel').count()))).reduce((a, b) => a + b, 0), 1);
  checks.push('surviving course wrapper reacquires the replaced question iframe and keeps a single controller');
  const diagnostic = await test.page.evaluate(() => window.__navigationTest.diagnosticReport());
  assert.equal(diagnostic.version, '0.5.2');
  assert.equal(diagnostic.autoNext, true);
  assert.equal(diagnostic.documents.find(doc => doc.questionCount).nextAvailable, false);
  checks.push('diagnostics include script version, auto-next state and scoped next-button availability');
  await test.context.close();

  test = await setup({ repeat: true });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await waitStatus(test, /原题.*重复题目/);
  assert.equal(test.requests.length, 1);
  assert.equal(await test.page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
  checks.push('a reloaded copy of the same question pauses before another model request');
  await test.context.close();

  test = await setup({ switchTask: true });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await waitStatus(test, /离开原答题任务/);
  assert.equal(test.requests.length, 1);
  checks.push('navigation to a different course/task stops continuation before requesting or filling');
  await test.context.close();

  test = await setup({ navigationDelay: 500 });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await waitStatus(test, /页面刷新后将自动续答/);
  await test.page.locator('#cxds-panel [data-action=stop]').click();
  await test.page.waitForURL(url => url.searchParams.get('start') === '1');
  await test.page.locator('#cxds-panel [data-action=start]').waitFor();
  assert.equal(await test.page.locator('#cxds-panel [data-role=status]').textContent(), '等待开始');
  assert.equal(test.requests.length, 1);
  checks.push('pause during a pending platform save cancels continuation even if the platform later navigates');
  await test.context.close();

  test = await setup({ expired: true });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await waitStatus(test, /续答记录已过期/);
  assert.equal(test.requests.length, 1);
  checks.push('expired continuation state is consumed without answering the new page');
  await test.context.close();

  test = await setup({ autoNext: false });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await verifyComplete(test, 1);
  assert.equal(test.checkpoints.length, 0);
  checks.push('auto-next disabled leaves the current page in place with no continuation state');
  await test.context.close();

  test = await setup({ work: true });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await verifyComplete(test, 3);
  await waitStatus(test, /跨页续答完成.*手动提交/);
  checks.push('coursework can continue across full reloads and requires manual submission after such continuation');
  await test.context.close();

  test = await setup({ failedSave: true });
  await test.page.locator('#cxds-panel [data-action=start]').click();
  await waitStatus(test, /翻页后题目未变化/, 20000);
  assert.equal(test.requests.length, 1);
  assert.equal(await test.page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
  checks.push('failed save or blocked navigation times out and clears continuation state');
  await test.context.close();

  assert.deepEqual(errors, []);
  const report = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional documents with real browser and iframe navigations; API and platform-save responses mocked; no live account or server-save verification.' };
  fs.writeFileSync(path.join(root, 'preview/跨页续答检查.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
