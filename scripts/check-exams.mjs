import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
assert(!source.includes('__examTest'));
const code = source.replace(hook, '  window.__examTest = { roots, parseQuestion, diagnosticReport, run, stop };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const origin = 'https://mooc1.chaoxing.com';
const examPath = '/exam-ans/exam/test/reVersionTestStartNew';
const checks = [], errors = [];
const question = (id = 101, type = '0', initial = '') => {
  const multiple = type === '1';
  const text = ['2', '4'].includes(type);
  const keys = type === '3' ? ['A', 'B'] : ['A', 'B', 'C', 'D'];
  return `<section class="questionLi" data="${id}"><h3 class="mark_name">${id - 100}.（${multiple ? '多选' : type === '3' ? '判断' : text ? '填空' : '单选'}题）虚构练习</h3>
    <input type="hidden" name="type${id}" value="${type}"><input type="hidden" id="answer${id}" name="answer${id}" value="${initial}">
    ${text ? '<textarea></textarea>' + (type === '2' ? '<textarea></textarea>' : '') : keys.map((key, index) => {
      const data = type === '3' ? String(index === 0) : key;
      return `<div class="answerBg" role="${multiple ? 'checkbox' : 'radio'}"><span class="${multiple ? 'num_option_dx' : 'num_option'} ${initial.includes(data) ? multiple ? 'check_answer_dx' : 'check_answer' : ''}" data="${data}">${key}</span><div class="answer_p">${type === '3' ? index === 0 ? '对' : '错' : '虚构选项' + key}</div></div>`;
    }).join('')}</section>`;
};
const submit = '<button id="submit" onclick="window.__submitted++">提交</button><button onclick="window.__submitted++">提交试卷</button><button onclick="window.__submitted++">交卷</button>';
const handlers = `<script>
  window.__submitted = 0;
  document.addEventListener('click', event => {
    const option = event.target.closest('.answerBg');
    if (!option) return;
    const q = option.closest('.questionLi');
    const marker = option.querySelector('.num_option, .num_option_dx');
    const multiple = q.querySelector('input[name^=type]').value === '1';
    const state = multiple ? 'check_answer_dx' : 'check_answer';
    const wasSelected = marker.classList.contains(state);
    if (!multiple) for (const peer of q.querySelectorAll('.num_option')) peer.classList.remove(state);
    marker.classList.toggle(state, !wasSelected);
    if (!q.hasAttribute('data-stale-save')) q.querySelector('input[id^=answer]').value = [...q.querySelectorAll('.' + state)].map(el => el.getAttribute('data')).join('');
  });
</script>`;

async function setup(body = question(), options = {}) {
  const context = await browser.newContext();
  await context.addInitScript(({ answers, settings }) => {
    window.__requests = [];
    window.__stored = { apiKey: 'offline-fixture-key', model: 'offline-model', delayMs: 0, autoNext: true, autoSubmit: true, expectedTotal: 0, ...settings };
    window.GM_getValue = () => window.__stored;
    window.GM_setValue = (_key, value) => { window.__stored = value; };
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      window.__requests.push(JSON.parse(request.data));
      const reply = () => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers, needs_review: false }) } }] }) });
      if (window.__hold) window.__reply = reply;
      else setTimeout(reply, 0);
      return { abort() { request.onabort(); } };
    };
  }, { answers: options.answers || ['B'], settings: options.settings || {} });
  const outerPath = options.outerExam ? '/exam/fixture' : '/mycourse/studentstudy';
  const innerPath = options.outerExam ? '/work/fixture' : examPath;
  const routes = new Map([[innerPath, body + submit + handlers]]);
  if (options.wrapped) routes.set(outerPath, `<button onclick="window.__outerSubmitted=true">提交</button><iframe src="${innerPath}"></iframe>`);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return routes.has(url.pathname) ? route.fulfill({ contentType: 'text/html;charset=utf-8', body: routes.get(url.pathname) }) : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + (options.wrapped ? outerPath : innerPath) + '?private=DO_NOT_EXPORT');
  for (const frame of page.frames()) await frame.evaluate(code => (0, eval)(code), code);
  return { context, page, work: page.frames().find(frame => new URL(frame.url()).pathname === innerPath) };
}

async function finished(test) {
  await test.page.evaluate(() => window.__examTest.run());
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), /填答完成.*手动交卷/);
  assert.equal(await test.work.evaluate(() => window.__submitted), 0);
}

try {
  let test = await setup();
  assert.equal(await test.page.locator('#cxds-panel').count(), 1);
  assert.equal(await test.page.locator('#cxds-panel [data-field=autoSubmit]').isDisabled(), true);
  assert.equal(await test.page.locator('#cxds-panel [data-field=autoSubmit]').isChecked(), false);
  await finished(test);
  assert.equal(await test.work.locator('#answer101').inputValue(), 'B');
  assert.equal(await test.work.evaluate(() => window.__examTest.parseQuestion(window.__examTest.roots()[0]).id), '101');
  assert.equal(await test.page.evaluate(() => window.__stored.autoSubmit), true);
  checks.push('direct exam entry mounts; named type supplies stable id; single-choice stored value verified; saved coursework submission preference retained; no exam submission');
  await test.context.close();

  test = await setup(question(101, '1', 'BC'), { answers: ['A', 'D'] });
  await finished(test);
  assert.equal(await test.work.locator('#answer101').inputValue(), 'AD');
  checks.push('exam multi-choice clears old values and verifies the full stored answer');
  await test.context.close();

  test = await setup(question(101, '3'), { answers: ['B'] });
  await finished(test);
  assert.equal(await test.work.locator('#answer101').inputValue(), 'false');
  checks.push('exam judgement letters map to true/false stored values');
  await test.context.close();

  for (const [type, answers] of [['2', ['第一空', '第二空']], ['4', ['虚构简答']]]) {
    test = await setup(question(101, type), { answers });
    await finished(test);
    assert.deepEqual(await test.work.locator('textarea').evaluateAll(inputs => inputs.map(input => input.value)), answers);
    checks.push(type === '2' ? 'exam multiple text blanks filled in order' : 'exam short-answer text field filled');
    await test.context.close();
  }

  test = await setup(question(), { wrapped: true });
  assert.equal((await Promise.all(test.page.frames().map(frame => frame.locator('#cxds-panel').count()))).reduce((a, b) => a + b, 0), 1);
  assert.equal(await test.page.locator('#cxds-panel [data-field=autoSubmit]').isDisabled(), true);
  await finished(test);
  assert.equal(await test.work.locator('#answer101').inputValue(), 'B');
  assert.equal(await test.page.evaluate(() => !!window.__outerSubmitted), false);
  const report = await test.page.evaluate(() => window.__examTest.diagnosticReport());
  assert.equal(report.questionCount, 1);
  assert(!JSON.stringify(report).includes('DO_NOT_EXPORT'));
  checks.push('visible nested exam participates in discovery; one panel; submission disabled in wrapper and exam; diagnostic redacted');
  await test.context.close();

  test = await setup(question(), { wrapped: true, outerExam: true, settings: { expectedTotal: 1 } });
  await finished(test);
  checks.push('exam wrapper with work-path question iframe also requires manual hand-in');
  await test.context.close();

  test = await setup('<div id="question-slot"></div>');
  assert.equal(await test.page.locator('#cxds-panel').count(), 1);
  await test.page.evaluate(html => setTimeout(() => document.querySelector('#question-slot').innerHTML = html, 150), question());
  await finished(test);
  checks.push('exam panel mounts before asynchronously loaded questions arrive');
  await test.context.close();

  test = await setup(question() + '<a id="next" onclick="getTheNextQuestion(1)">下一题</a>');
  await test.work.evaluate(second => {
    window.getTheNextQuestion = () => {
      document.querySelector('.questionLi').outerHTML = second;
      document.querySelector('#next').classList.add('disabled');
    };
  }, question(102));
  await finished(test);
  assert.equal(await test.work.locator('#answer102').inputValue(), 'B');
  assert.equal(await test.page.evaluate(() => window.__requests.length), 2);
  checks.push('exam Ajax next-question replacement re-parses named ids and stops at disabled final navigation');
  await test.context.close();

  test = await setup(question().replace('class="questionLi"', 'class="questionLi" data-stale-save'));
  await test.page.evaluate(() => window.__examTest.run());
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), /页面未确认填答状态/);
  assert.equal(await test.work.locator('#answer101').inputValue(), '');
  assert.equal(await test.work.evaluate(() => window.__submitted), 0);
  checks.push('visual exam selection without answer-field update pauses');
  await test.context.close();

  test = await setup();
  await test.page.evaluate(() => { window.__hold = true; window.__pendingRun = window.__examTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  await test.page.evaluate(async () => { window.__examTest.stop(); window.__reply(); await window.__pendingRun; });
  assert.equal(await test.work.locator('#answer101').inputValue(), '');
  assert.equal(await test.work.evaluate(() => window.__submitted), 0);
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), /手动暂停/);
  checks.push('manual pause ignores a late model response without filling or submitting');
  await test.context.close();

  assert.deepEqual(errors, []);
  const reportResult = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional exam layouts; model requests mocked locally; no live account, paid API or server-save verification.' };
  fs.writeFileSync(path.join(root, 'preview/考试适配检查.json'), JSON.stringify(reportResult, null, 2) + '\n');
  console.log(JSON.stringify(reportResult, null, 2));
} finally {
  await browser.close();
}
