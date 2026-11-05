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
assert(!source.includes('__adapterTest'));
const code = source.replace(hook, '  window.__adapterTest = { roots, parseQuestion, diagnosticReport, run };\n' + hook);
const png = (await sharp({ create: { width: 30, height: 15, channels: 4, background: '#0000ff' } }).png().toBuffer()).toString('base64');
const image = `<img src="data:image/png;base64,${png}">`;
const legacyOption = (key, content = key) => `<li data-test-option><label><span class="num_option">${key}</span></label><a class="after">${content}</a></li>`;
const nativeOption = (key, type = 'radio', attrs = '') => `<label><input type="${type}" name="answer" value="${key}" ${attrs}>${key}. 选项${key}</label>`;
const roleOption = (key, role = 'radio', attrs = '') => `<div data-test-option role="${role}" data-option="${key}" aria-checked="false" ${attrs}><span class="option-label">${key}</span>选项${key}</div>`;
const customOption = key => `<button type="button" class="option-item" data-test-option data-option="${key}"><span class="uncheck_answer">${key}. 选项${key}</span></button>`;
const header = '<h3 class="mark_name">1. 单选题：请选择</h3>';
const wrap = (body, attrs = 'class="TiMu"') => `<section data-test-question ${attrs}>${header}${body}</section>`;
const cases = [
  { name: 'legacy aria-hidden list and image-only options', html: wrap(`<input id="answertype1" type="hidden" value="0"><ul class="Zy_ulTop" aria-hidden="true">${['A', 'B', 'C', 'D'].map(k => legacyOption(k, image)).join('')}</ul>`), keys: ['A', 'B', 'C', 'D'], answers: ['D'], adapter: 'legacy' },
  { name: 'native radios retain letters when DOM order differs', html: wrap(['C', 'A', 'B'].map(k => nativeOption(k)).join(''), 'class="questionLi"'), keys: ['C', 'A', 'B'], answers: ['C'], adapter: 'native' },
  { name: 'checkbox inference clears old choices and selects the complete new set', html: '<section data-test-question data-qid="fictional"><h3 class="question-title">请选择动物</h3>' + ['A', 'B', 'C', 'D'].map(k => nativeOption(k, 'checkbox', ['B', 'C'].includes(k) ? 'checked' : '')).join('') + '</section>', keys: ['A', 'B', 'C', 'D'], answers: ['A', 'D'], type: 'multiple' },
  { name: 'hidden native inputs use visible labels associated by for', html: wrap('<input style="display:none" type="radio" name="a" id="a" value="A"><label for="a">A. 甲</label><input style="display:none" type="radio" name="a" id="b" value="B"><label for="b">B. 乙</label>'), keys: ['A', 'B'], answers: ['B'] },
  { name: 'answerBg adapter uses explicit option markers', html: wrap(['D', 'B', 'A', 'C'].map(k => `<div class="answerBg" data-test-option><span class="answer_n">${k}</span><div class="answer_p">内容${k}</div></div>`).join('')), keys: ['D', 'B', 'A', 'C'], answers: ['A'], adapter: 'answer-bg' },
  { name: 'semantic ARIA radio groups infer type and use actual letters', html: '<div data-test-question data-question-id="fictional"><h3 class="question-title">请选择</h3><div aria-hidden="true">' + ['C', 'A', 'B'].map(k => roleOption(k)).join('') + '</div></div>', keys: ['C', 'A', 'B'], answers: ['B'], adapter: 'aria' },
  { name: 'generic data-option buttons use exact selected classes', html: '<section data-test-question data-role="question" data-type="single"><h4 data-role="question-title">请选择</h4>' + ['B', 'A'].map(customOption).join('') + '</section>', keys: ['B', 'A'], answers: ['A'], adapter: 'semantic', classState: true },
  { name: 'fieldset legend and native radio controls', html: '<fieldset data-test-question data-questionid="fictional"><legend>1. 单选题：请选择</legend>' + ['A', 'B'].map(k => nativeOption(k)).join('') + '</fieldset>', keys: ['A', 'B'], answers: ['B'] },
  { name: 'nested question wrappers produce one question', html: '<div class="TiMu">' + wrap(['A', 'B'].map(k => nativeOption(k)).join(''), 'class="questionLi"') + '</div>', keys: ['A', 'B'], answers: ['A'] },
  { name: 'CSS and HTML hidden duplicate groups are excluded', html: wrap('<div style="display:none">' + roleOption('A') + roleOption('B') + '</div><div hidden>' + roleOption('A') + roleOption('B') + '</div>' + roleOption('A') + roleOption('C')), keys: ['A', 'C'], answers: ['C'] },
  { name: '15 lazy formula images use stable HTTPS addresses', html: wrap('<input id="answertype1" type="hidden" value="0"><ul class="Zy_ulTop" aria-hidden="true">' + ['A', 'B', 'C', 'D'].map((k, i) => legacyOption(k, Array.from({ length: i === 3 ? 3 : 4 }, (_, n) => `<img src="data:image/png;base64,${png}" data-original="http://p.ananas.chaoxing.com/star3/origin/fictional-${k}-${n}.png">`).join(''))).join('') + '</ul>'), keys: ['A', 'B', 'C', 'D'], answers: ['B'], mediaCount: 15 },
  { name: 'duplicate visible option letters pause before requesting', html: wrap(customOption('A') + customOption('A')), error: /选项字母重复/ },
  { name: 'read-only fieldset pauses before requesting', html: '<fieldset data-test-question data-questionid="fictional" disabled><legend>1. 单选题：请选择</legend>' + nativeOption('A') + nativeOption('B') + '</fieldset>', error: /选项不可编辑/ },
  { name: 'disabled target prevents all partial mutations', html: wrap(nativeOption('A', 'radio', 'checked') + nativeOption('B', 'radio', 'disabled')), keys: ['A', 'B'], answers: ['B'], error: /选项不可编辑/, expectedRequests: 1, keepChecked: 'A' },
  { name: 'late-rendered option controls and inferred types are awaited', html: '<section data-test-question class="question-item"><h3 class="question-title">请选择</h3><div id="late"></div></section>', delayed: roleOption('A') + roleOption('B'), keys: ['A', 'B'], answers: ['B'] },
  { name: 'ARIA checkbox groups clear previous values', html: '<div data-test-question class="question-item" data-multi="true"><h4 class="questionTitle">请选择</h4>' + ['A', 'B', 'C'].map(k => roleOption(k, 'checkbox').replace('aria-checked="false"', `aria-checked="${k === 'B'}"`)).join('') + '</div>', keys: ['A', 'B', 'C'], answers: ['A', 'C'], type: 'multiple' },
  { name: 'explicit unsupported type is not replaced by control inference', html: wrap(nativeOption('A') + nativeOption('B'), 'class="questionLi" data-question-type="unsupported"'), error: /不支持的题型/ },
  { name: 'unknown layout reports adapter and visible count', html: wrap('<p>尚无选项控件</p>'), parseOnly: true, error: /无法识别完整选项.*unknown.*0/ },
  { name: 'legacy selected state agrees with the stored answer field', html: wrap('<input type="hidden" id="answertype1" value="0"><input type="hidden" id="answer1" value="A"><ul class="Zy_ulTop">' + ['A', 'B'].map(k => legacyOption(k).replace('class="num_option"', `class="num_option" data="${k}"`)).join('') + '</ul>'), keys: ['A', 'B'], answers: ['B'] },
  { name: 'visual selection without a stored answer is rejected', html: wrap('<input type="hidden" id="answertype1" value="0"><input type="hidden" id="answer1" value="A"><ul class="Zy_ulTop">' + ['A', 'B'].map(k => legacyOption(k).replace('class="num_option"', `class="num_option" data="${k}"`)).join('') + '</ul>', 'class="TiMu" data-stale-save="true"'), answers: ['B'], expectedRequests: 1, error: /页面未确认填答状态/ }
];
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
assert(edge);
const browser = await chromium.launch({ executablePath: edge, headless: true });
const checks = [], errors = [];
try {
  for (const sample of cases) {
    const context = await browser.newContext();
    await context.addInitScript(({ answers, png }) => {
      window.__requests = [];
      window.__media = [];
      window.GM_getValue = () => ({ apiKey: 'offline-fixture-key', model: 'deepseek-flash', delayMs: 0, autoNext: false, autoSubmit: false });
      window.GM_setValue = () => {};
      window.GM_registerMenuCommand = () => {};
      window.GM_xmlhttpRequest = request => {
        if (request.responseType === 'arraybuffer') {
          window.__media.push(request.url);
          setTimeout(() => request.onload({ status: 200, finalUrl: request.url, response: Uint8Array.from(atob(png), c => c.charCodeAt(0)).buffer }), 0);
        } else {
          window.__requests.push(JSON.parse(request.data));
          setTimeout(() => request.onload({ status: 200, responseText: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers, needs_review: false }) } }] }) }), 0);
        }
        return { abort() { request.onabort(); } };
      };
    }, { answers: sample.answers || ['A'], png });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).pathname === '/work/adapters') return route.fulfill({ contentType: 'text/html;charset=utf-8', body: sample.html });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://mooc1.chaoxing.com/work/adapters');
    await page.evaluate(({ classState, multiple }) => {
      document.addEventListener('click', event => {
        const option = event.target.closest('[data-test-option]');
        if (!option) return;
        const group = option.closest('[data-test-question]');
        const wasSelected = option.getAttribute('aria-checked') === 'true' || option.classList.contains('selected');
        if (!multiple) for (const peer of group.querySelectorAll('[data-test-option]')) {
          peer.removeAttribute('aria-checked');
          peer.classList.remove('selected');
        }
        if (classState) option.classList.toggle('selected', multiple ? !wasSelected : true);
        else option.setAttribute('aria-checked', String(multiple ? !wasSelected : true));
        if (!group.hasAttribute('data-stale-save')) {
          const saved = group.querySelector('input[id="answer1"]');
          if (saved) saved.value = [...group.querySelectorAll('[data-test-option][aria-checked="true"] .num_option')].map(el => el.getAttribute('data')).join('');
        }
      });
    }, { classState: !!sample.classState, multiple: sample.type === 'multiple' });
    await page.addScriptTag({ content: code });
    if (sample.delayed) await page.evaluate(html => setTimeout(() => document.querySelector('#late').innerHTML = html, 250), sample.delayed);
    assert.equal(await page.evaluate(() => window.__adapterTest.roots().length), 1, sample.name);
    if (sample.parseOnly) {
      const report = await page.evaluate(() => window.__adapterTest.diagnosticReport().questions[0]);
      assert.match(report.parseError, sample.error);
      assert.equal(report.choiceElements, 0);
    } else {
      await page.evaluate(() => window.__adapterTest.run());
      const status = await page.locator('#cxds-panel [data-role="status"]').textContent();
      if (sample.error) {
        assert.match(status, sample.error, sample.name);
        assert.equal(await page.evaluate(() => window.__requests.length), sample.expectedRequests || 0, sample.name);
        if (sample.keepChecked) assert.equal(await page.locator('input:checked').inputValue(), sample.keepChecked);
      } else {
        assert.match(status, /填答完成/, sample.name + ': ' + status);
        const state = await page.evaluate(() => {
          const q = window.__adapterTest.parseQuestion(window.__adapterTest.roots()[0]);
          return { keys: q.choices.map(c => c.key), adapter: q.adapter, type: q.type,
            chosen: q.choices.filter(c => c.input ? c.input.checked : c.container.getAttribute('aria-checked') === 'true' || c.container.classList.contains('selected')).map(c => c.key) };
        });
        assert.deepEqual(state.keys, sample.keys, sample.name);
        assert.deepEqual(state.chosen.sort(), [...sample.answers].sort(), sample.name);
        assert.equal(state.type, sample.type || 'single', sample.name);
        if (sample.adapter) assert.equal(state.adapter, sample.adapter, sample.name);
        if (sample.mediaCount) {
          assert.equal(await page.evaluate(() => window.__media.length), sample.mediaCount);
          assert(await page.evaluate(() => window.__media.every(url => url.startsWith('https://p.ananas.chaoxing.com/'))));
          assert.equal(await page.evaluate(() => window.__requests[0].messages[1].content.filter(c => c.type === 'image_url').length), sample.mediaCount);
        }
      }
    }
    checks.push(sample.name);
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = { result: 'PASS', checks, browserErrors: errors, limits: 'Fictional structural variants; all model and image requests mocked locally.' };
  fs.writeFileSync(path.join(root, 'preview/通用适配检查.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
