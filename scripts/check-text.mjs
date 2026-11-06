import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'dist/chaoxing-deepseek-homework.user.js'), 'utf8');
const hook = '  mount();\n  if (!panel)';
assert.equal(source.split(hook).length, 2);
const code = source.replace(hook, '  window.__textTest = { roots, parseQuestion, diagnosticReport, run, stop };\n' + hook);
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [], errors = [];
const iframe = (id = 'frame1', editor = false) => `<div class="${editor ? 'edui-editor' : 'text-area'}"><iframe id="${id}"></iframe></div>`;

async function setup(body, options = {}) {
  const context = await browser.newContext();
  await context.addInitScript(({ answers, review }) => {
    window.unsafeWindow = window;
    window.__requests = [];
    window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'offline-model', delayMs: 0, autoNext: true, autoSubmit: false });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = request => {
      window.__requests.push(JSON.parse(request.data));
      const reply = () => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers, needs_review: !!review }) } }] }) });
      if (window.__hold) window.__reply = reply; else setTimeout(reply, 0);
      return { abort() { request.onabort(); } };
    };
  }, { answers: options.answers || ['完整答案'], review: options.review });
  const taskPath = '/exam-ans/exam/test/reVersionTestStartNew';
  const fixture = `<form><section class="questionLi"><h3 class="mark_name">1. ${options.title || '简答题：虚构问题'}</h3>${options.infer ? '' : `<input type="hidden" name="type101" value="${options.type || '4'}">`}${body}</section></form>`;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mycourse/studentstudy') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<iframe id="work" src="${taskPath}"></iframe>` });
    if (url.pathname === taskPath) return route.fulfill({ contentType: 'text/html;charset=utf-8', body: fixture });
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://mooc1.chaoxing.com' + (options.wrapped ? '/mycourse/studentstudy' : taskPath));
  const work = page.frames().find(frame => new URL(frame.url()).pathname === taskPath);
  await work.evaluate(options => {
    window.__editorSets = 0;
    window.__editorSyncs = 0;
    window.UE = { instants: {} };
    for (const [index, frame] of [...document.querySelectorAll('.questionLi iframe')].entries()) {
      const doc = frame.contentDocument;
      doc.open(); doc.write('<!doctype html><body contenteditable="true"><p></p></body>'); doc.close();
      if (options.designMode) { doc.body.removeAttribute('contenteditable'); doc.designMode = 'on'; }
      if (frame.closest('.edui-editor')) {
        const textarea = document.createElement('textarea');
        textarea.style.display = 'none';
        textarea.name = 'answerEditor101' + (index + 1);
        textarea.id = 'ueditor_textarea_' + textarea.name;
        textarea.value = options.stale ? 'OLD' : '';
        frame.parentElement.append(textarea);
        const editor = { iframe: frame, body: doc.body, isReady: options.delayed ? 0 : 1, textarea, options: { textarea: textarea.name },
          setContent(html) { window.__editorSets++; this.body.innerHTML = html; },
          getContent() { return this.body.innerHTML; },
          sync() { window.__editorSyncs++; if (!options.stale) this.textarea.value = this.getContent(); } };
        window.UE.instants['ueditorInstant' + index] = editor;
        if (options.readonly || options.delayed) doc.body.contentEditable = 'false';
        if (options.delayed) setTimeout(() => { editor.isReady = 1; doc.body.contentEditable = 'true'; }, 200);
      }
      doc.body.addEventListener('input', event => { window.__validInputEvent = event instanceof doc.defaultView.Event; });
    }
    if (options.saveNext) {
      const next = document.createElement('button');
      next.type = 'button'; next.textContent = '下一题';
      next.onclick = () => {
        window.__saved = Object.values(window.UE.instants).map(editor => editor.textarea.value);
        next.remove();
        document.querySelector('.mark_name').textContent = '2. 单选题：虚构后续题';
        document.querySelector('.questionLi').innerHTML = '<h3 class="mark_name">2. 单选题：虚构后续题</h3><label><input type="radio" name="choice" value="A">A. 甲</label><label><input type="radio" name="choice" value="B">B. 乙</label>';
      };
      document.querySelector('.questionLi').append(next);
    }
  }, options);
  await page.addScriptTag({ content: code });
  return { context, page, work };
}

async function run(test, error) {
  await test.page.evaluate(() => window.__textTest.run());
  const status = await test.page.locator('#cxds-panel [data-role=status]').textContent();
  assert.match(status, error || /填答完成/);
}

try {
  let test = await setup('<textarea></textarea>');
  await run(test);
  assert.equal(await test.work.locator('textarea').inputValue(), '完整答案');
  checks.push('native short-answer textarea still fills');
  await test.context.close();

  const calculation = '设 x < 3，y > 1。\nS = 2 × 3 = 6。\n答：6。';
  test = await setup(iframe(), { type: '5', answers: [calculation] });
  await run(test);
  assert.equal(await test.work.locator('#frame1').evaluate(frame => frame.contentDocument.body.innerText.trim()), calculation);
  assert.equal(await test.work.evaluate(() => window.__validInputEvent), true);
  assert.match(await test.page.evaluate(() => window.__requests[0].messages[0].content), /计算题.*必要计算/);
  checks.push('calculation steps, inequality symbols and line breaks fill a same-origin rich-text iframe using its own events');
  await test.context.close();

  test = await setup(iframe('editor1', true));
  await run(test);
  assert.equal(await test.work.evaluate(() => window.__editorSets), 1);
  assert.equal(await test.work.evaluate(() => window.__editorSyncs), 1);
  assert.match(await test.work.locator('textarea').inputValue(), /完整答案/);
  const report = await test.page.evaluate(() => window.__textTest.diagnosticReport());
  assert.equal(report.questions[0].adapter, 'ueditor');
  assert.equal(report.questions[0].textControls.fieldCount, 1);
  assert(!JSON.stringify(report).includes('完整答案'));
  assert(!JSON.stringify(report).includes('offline-fixture-key'));
  checks.push('UEditor instance setContent and sync update the hidden backing field; diagnostics expose counts without answer text or key');
  await test.context.close();

  test = await setup(iframe('editor1', true) + iframe('editor2', true), { type: '2', answers: ['第一空', '第二空'] });
  await run(test);
  assert.deepEqual(await test.work.locator('textarea').evaluateAll(inputs => inputs.map(input => input.value)), ['<p>第一空</p>', '<p>第二空</p>']);
  assert.equal(JSON.parse(await test.page.evaluate(() => window.__requests[0].messages[1].content)).blank_count, 2);
  checks.push('multiple UEditor blanks follow document order and do not count hidden backing fields twice');
  await test.context.close();

  const foldedBlank = id => `<div class="blankItemInp"><div class="InpDIV"></div><div class="textDIV" style="display:none">${iframe(id, true)}</div></div>`;
  test = await setup(foldedBlank('folded1') + foldedBlank('folded2'), { type: '2', answers: ['第一空', '第二空'] });
  await run(test);
  assert.deepEqual(await test.work.locator('textarea').evaluateAll(inputs => inputs.map(input => input.value)), ['<p>第一空</p>', '<p>第二空</p>']);
  assert.equal(await test.work.locator('.textDIV').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'none')), true);
  checks.push('chapter blank proxies expose ready folded UEditor instances in order without opening editors or writing hidden textareas directly');
  await test.context.close();

  test = await setup(foldedBlank('folded1'), { readonly: true });
  await run(test, /只读状态/);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('folded UEditor instances still reject read-only bodies');
  await test.context.close();

  test = await setup(foldedBlank('folded1'), { delayed: true });
  await run(test);
  assert.equal(await test.work.evaluate(() => window.__editorSyncs), 1);
  checks.push('folded UEditor readiness is awaited before requesting an answer');
  await test.context.close();

  test = await setup(`<div hidden>${foldedBlank('hidden1')}</div>` + iframe('visible1', true));
  await run(test);
  assert.deepEqual(await test.work.locator('textarea').evaluateAll(inputs => inputs.map(input => input.value)), ['', '<p>完整答案</p>']);
  checks.push('a hidden blank proxy cannot make its hidden UEditor count as an answer field');
  await test.context.close();

  test = await setup(foldedBlank('hidden1').replace('<iframe ', '<iframe hidden ') + iframe('visible1', true));
  await run(test);
  assert.deepEqual(await test.work.locator('textarea').evaluateAll(inputs => inputs.map(input => input.value)), ['', '<p>完整答案</p>']);
  checks.push('a separately hidden editor frame stays excluded even beside a visible blank proxy');
  await test.context.close();

  test = await setup('<input type="text">' + iframe(), { type: '2', answers: ['第一空', '第二空'] });
  await run(test);
  assert.equal(await test.work.locator('.questionLi input[type=text]').inputValue(), '第一空');
  assert.equal(await test.work.locator('#frame1').evaluate(frame => frame.contentDocument.body.innerText.trim()), '第二空');
  checks.push('mixed native and iframe text blanks retain their document order');
  await test.context.close();

  test = await setup('<div role="toolbar"><input type="text"></div><div contenteditable="true"><div contenteditable="true"></div></div>');
  await run(test);
  assert.equal(await test.work.locator('[role=toolbar] input').inputValue(), '');
  assert.equal(JSON.parse(await test.page.evaluate(() => window.__requests[0].messages[1].content)).blank_count, 1);
  checks.push('nested editable nodes produce one answer field and toolbar inputs are excluded');
  await test.context.close();

  test = await setup(iframe(), { designMode: true, infer: true, title: '计算题：虚构计算' });
  await run(test);
  checks.push('designMode iframe and calculation-title type inference are supported');
  await test.context.close();

  test = await setup(iframe('editor1', true), { delayed: true, wrapped: true });
  await run(test);
  assert.equal(await test.work.evaluate(() => window.__editorSyncs), 1);
  checks.push('late UEditor readiness is awaited in a nested course frame before requesting an answer');
  await test.context.close();

  test = await setup(iframe('editor1', true), { readonly: true });
  await run(test, /只读状态/);
  assert.equal(await test.page.evaluate(() => window.__requests.length), 0);
  checks.push('read-only rich-text editors pause before a model request');
  await test.context.close();

  test = await setup(iframe('editor1', true), { stale: true, saveNext: true });
  await run(test, /页面未确认填答状态/);
  assert.equal(await test.work.locator('textarea').inputValue(), 'OLD');
  assert.equal(await test.work.evaluate(() => !!window.__saved), false);
  checks.push('visual/editor content without a synchronized backing field cannot proceed to next question');
  await test.context.close();

  test = await setup(iframe('editor1', true), { review: true });
  await run(test, /人工检查/);
  assert.equal(await test.work.evaluate(() => window.__editorSets), 0);
  checks.push('model uncertainty leaves the editor unchanged');
  await test.context.close();

  test = await setup(iframe());
  await test.page.evaluate(() => { window.__hold = true; window.__pending = window.__textTest.run(); });
  await test.page.waitForFunction(() => !!window.__reply);
  await test.work.evaluate(() => { const frame = document.querySelector('#frame1'); frame.contentDocument.open(); frame.contentDocument.write('<body contenteditable="true"></body>'); frame.contentDocument.close(); });
  await test.page.evaluate(() => { window.__reply(); return window.__pending; });
  assert.match(await test.page.locator('#cxds-panel [data-role=status]').textContent(), /编辑器已切换/);
  assert.equal(await test.work.locator('#frame1').evaluate(frame => frame.contentDocument.body.textContent), '');
  checks.push('editor document replacement during a model request prevents stale text writes');
  await test.context.close();

  test = await setup(iframe('editor1', true) + iframe('editor2', true), { type: '2' });
  await run(test, /答案数量与填空数量不一致/);
  assert.equal(await test.work.evaluate(() => window.__editorSets), 0);
  checks.push('wrong answer count prevents partial mutations across multiple blanks');
  await test.context.close();

  const literal = '<img src=x onerror="window.pwned=1">\n<script>window.pwned=1</script>';
  test = await setup(iframe('editor1', true), { answers: [literal] });
  await run(test);
  assert.equal(await test.work.locator('#editor1').evaluate(frame => frame.contentDocument.querySelectorAll('img,script').length), 0);
  assert.equal(await test.work.locator('#editor1').evaluate(frame => !!frame.contentWindow.pwned), false);
  checks.push('model text is escaped before rich-text insertion; HTML-like answers remain literal');
  await test.context.close();

  assert.deepEqual(errors, []);
  const result = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional native/contenteditable/iframe fixtures and UEditor API fixtures; model requests mocked locally. No live page or server-save verification.' };
  fs.writeFileSync(path.join(root, 'preview/文本答题检查.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
