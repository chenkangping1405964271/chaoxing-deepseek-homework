// ==UserScript==
// @name         学习通作业 DeepSeek 自动填答
// @namespace    cxds.homework
// @version      0.4.4
// @license      MIT
// @homepageURL  https://github.com/chenkangping1405964271/chaoxing-deepseek-homework
// @supportURL   https://github.com/chenkangping1405964271/chaoxing-deepseek-homework/issues
// @downloadURL  https://raw.githubusercontent.com/chenkangping1405964271/chaoxing-deepseek-homework/refs/heads/codex/open-source/dist/chaoxing-deepseek-homework.user.js
// @updateURL    https://raw.githubusercontent.com/chenkangping1405964271/chaoxing-deepseek-homework/refs/heads/codex/open-source/dist/chaoxing-deepseek-homework.meta.js
// @description  在普通作业页面调用 DeepSeek 并填答
// @match        *://*.chaoxing.com/*
// @match        *://chaoxing.com/*
// @connect      api.deepseek.com
// @connect      chaoxing.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 chaoxing-deepseek-homework contributors

(() => {
  'use strict';

  // One controller per accessible frame tree keeps wrappers from showing duplicate panels.
  try { if (window.parent !== window && window.parent.document) return; } catch { /* Separate origin. */ }

  const SETTINGS = 'cxds.settings.v1';
  const ART = __CXDS_ART__;
  const PANEL_HTML = __CXDS_PANEL__;
  const defaults = { apiKey: '', model: '', autoNext: true, autoSubmit: false, expectedTotal: 0, delayMs: 1000 };
  const settings = { ...defaults, ...GM_getValue(SETTINGS, {}) };
  let running = false;
  let generation = 0;
  let activeRequest = null;
  let rejectRequest = null;
  let panel;
  let statusNode;
  let logNode;

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isExam = doc => /\/exam(?:-ans)?\//i.test(doc.location.pathname);
  const rootsIn = doc => {
    const candidates = [...doc.querySelectorAll('.TiMu, .questionLi')].filter(visible);
    return candidates.filter(root => !candidates.some(other => root !== other && root.contains(other)));
  };
  const roots = () => frameDocuments().documents.flatMap(rootsIn);
  const field = name => panel.querySelector(`[data-field="${name}"]`);
  const action = name => panel.querySelector(`[data-action="${name}"]`);

  function frameDocuments() {
    const documents = [], frames = [], visited = new Set();
    const visit = doc => {
      if (visited.has(doc) || isExam(doc)) return;
      visited.add(doc);
      documents.push(doc);
      for (const frame of doc.querySelectorAll('iframe, frame')) {
        if (!visible(frame)) continue;
        let child;
        try { child = frame.contentDocument; if (child) void child.location.href; } catch { child = null; }
        frames.push({ accessible: !!child, page: child ? child.location.origin + child.location.pathname : null });
        if (child) visit(child);
      }
    };
    visit(document);
    return { documents, frames };
  }

  async function findQuestionDocument(token) {
    setStatus('正在等待作业题目加载');
    for (let i = 0; i <= 100; i++) {
      assertRunning(token);
      const { documents, frames } = frameDocuments();
      const matches = documents.filter(doc => rootsIn(doc).length);
      if (matches.length > 1) throw new Error('发现多个作业页面，请只打开一份作业');
      if (matches.length === 1) return matches[0];
      if (i === 100) throw new Error(frames.some(f => !f.accessible)
        ? '题目所在 iframe 无法访问，请切换到题目内的助手或单独打开作业页'
        : '作业题目尚未加载，请先打开可作答的作业再开始');
      await wait(100);
    }
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }

  function visibleOptionText(el) {
    const parent = el && el.parentElement;
    if (!parent || !visible(parent) || el.hidden || parent.matches('[disabled], [aria-disabled="true"], .disabled')) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function setStatus(message) {
    statusNode.textContent = message;
    syncCompanion(message);
    const line = document.createElement('div');
    line.textContent = message;
    logNode.prepend(line);
    while (logNode.children.length > 15) logNode.lastChild.remove();
  }

  function showPose(key, preview = false) {
    if (!panel || !ART[key]) return;
    for (const image of panel.querySelectorAll('[data-role="mascot"], [data-role="dock-mascot"]')) {
      if (image.dataset.pose !== key) {
        image.dataset.pose = key;
        image.src = ART[key];
      }
    }
    for (const button of panel.querySelectorAll('.pose[data-pose]')) button.setAttribute('aria-pressed', String(button.dataset.pose === key));
    if (preview) {
      const names = { welcome: '打个招呼', thinking: '认真思考', rest: '歇一小会', complete: '小小庆祝' };
      panel.querySelector('[data-role="companion-caption"]').textContent = '贴纸预览 · ' + names[key];
    }
  }

  function syncCompanion(message) {
    if (!panel || !statusNode) return;
    let pose = 'welcome', tone = 'idle', caption = 'DeepSeek 娘准备好啦';
    if (/已暂停|手动暂停/.test(message)) {
      pose = 'rest'; tone = 'paused'; caption = '歇一小会，等你回来';
    } else if (/填答完成|已点击提交/.test(message)) {
      pose = 'complete'; tone = 'complete'; caption = '这一轮完成啦，记得核对哦';
    } else if (running || /正在请求/.test(message)) {
      pose = 'thinking'; tone = 'working'; caption = 'DeepSeek 娘正在思考';
    }
    showPose(pose);
    panel.querySelector('.box').dataset.tone = tone;
    panel.querySelector('[data-role="companion-caption"]').textContent = caption;
    panel.querySelector('[data-role="key-state"]').textContent = settings.apiKey ? '已配置' : '待配置';
  }

  function saveSettings() {
    const newKey = field('apiKey').value.trim();
    if (newKey) settings.apiKey = newKey;
    field('apiKey').value = '';
    settings.model = field('model').value.trim();
    settings.autoNext = field('autoNext').checked;
    settings.autoSubmit = field('autoSubmit').checked;
    settings.expectedTotal = Number(field('expectedTotal').value) || 0;
    settings.delayMs = Math.max(0, Math.min(30000, Number(field('delayMs').value) || 0));
    GM_setValue(SETTINGS, { ...settings });
  }

  function lock(value) {
    running = value;
    action('start').disabled = value;
    action('stop').disabled = !value;
    for (const name of ['save', 'models', 'test', 'clearKey']) action(name).disabled = value;
    for (const button of panel.querySelectorAll('.pose[data-pose]')) button.disabled = value;
    syncCompanion(value ? '正在准备' : statusNode.textContent);
  }

  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      if (!settings.apiKey) return reject(new Error('请先保存 DeepSeek API Key'));
      let finished = false;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        activeRequest = null;
        rejectRequest = null;
        callback(value);
      };
      rejectRequest = () => finish(reject, new Error('手动暂停'));
      activeRequest = GM_xmlhttpRequest({
        method,
        url: 'https://api.deepseek.com' + path,
        headers: { Authorization: 'Bearer ' + settings.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 180000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) return finish(reject, new Error('DeepSeek 请求失败，HTTP ' + response.status));
          try { finish(resolve, JSON.parse(response.responseText)); }
          catch { finish(reject, new Error('DeepSeek 返回的 JSON 无法解析')); }
        },
        onerror: () => finish(reject, new Error('DeepSeek 网络请求失败')),
        ontimeout: () => finish(reject, new Error('DeepSeek 请求超时')),
        onabort: () => finish(reject, new Error('手动暂停'))
      });
    });
  }

  async function completion(messages) {
    if (!settings.model) throw new Error('请先读取并选择模型');
    const data = await request('POST', '/chat/completions', {
      model: settings.model,
      messages,
      stream: false,
      response_format: { type: 'json_object' }
    });
    const result = data.choices && data.choices[0];
    if (!result || result.finish_reason !== 'stop' || typeof result.message?.content !== 'string') throw new Error('模型返回不完整');
    try { return JSON.parse(result.message.content); }
    catch { throw new Error('模型答案不是有效 JSON'); }
  }

  // Read image bytes locally and send only their contents to DeepSeek, never site cookies or signed URLs.
  function imageMime(bytes) {
    const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
    if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) {
      for (let i = 8; i + 8 <= bytes.length;) {
        const size = ((bytes[i] * 0x1000000) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3]) >>> 0;
        if (ascii(i + 4, 4) === 'acTL') throw new Error('暂不支持动画图片');
        if (size > bytes.length - i - 12) break;
        i += size + 12;
      }
      return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
    if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      for (let i = 12; i + 8 <= bytes.length;) {
        const tag = ascii(i, 4);
        const size = (bytes[i + 4] | bytes[i + 5] << 8 | bytes[i + 6] << 16 | bytes[i + 7] << 24) >>> 0;
        if (tag === 'ANIM' || tag === 'ANMF' || (tag === 'VP8X' && (bytes[i + 8] & 2))) throw new Error('暂不支持动画图片');
        if (size > bytes.length - i - 8) break;
        i += 8 + size + (size % 2);
      }
      return 'image/webp';
    }
    if (bytes.length >= 13 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
      let i = 13 + ((bytes[10] & 128) ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
      let frames = 0;
      const skipBlocks = () => {
        while (i < bytes.length) {
          const size = bytes[i++];
          if (!size) return;
          i += size;
          if (i > bytes.length) break;
        }
        throw new Error('GIF 图片格式不完整');
      };
      while (i < bytes.length) {
        const tag = bytes[i++];
        if (tag === 0x3b) break;
        if (tag === 0x21) { i++; skipBlocks(); continue; }
        if (tag !== 0x2c || i + 9 > bytes.length) throw new Error('GIF 图片格式不完整');
        frames++;
        if (frames > 1) throw new Error('暂不支持动画图片');
        const packed = bytes[i + 8];
        i += 9 + ((packed & 128) ? 3 * (1 << ((packed & 7) + 1)) : 0);
        i++; // LZW minimum code size
        skipBlocks();
      }
      if (frames !== 1) throw new Error('GIF 图片格式不完整');
      return 'image/gif';
    }
    throw new Error('图片格式不受支持，仅支持 PNG、JPEG、GIF 和 WebP');
  }

  function imageDataUrl(buffer) {
    const bytes = new Uint8Array(buffer);
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('图片为空或超过 8 MiB');
    const mime = imageMime(bytes);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${mime};base64,${btoa(binary)}`;
  }

  async function readImage(source) {
    if (/^data:/i.test(source)) {
      const match = source.match(/^data:image\/(?:png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
      if (!match) throw new Error('图片数据格式不受支持');
      if (match[1].length > 12 * 1024 * 1024) throw new Error('图片超过 8 MiB');
      let raw;
      try { raw = atob(match[1].replace(/\s/g, '')); } catch { throw new Error('图片数据无法读取'); }
      return imageDataUrl(Uint8Array.from(raw, char => char.charCodeAt(0)).buffer);
    }
    const url = new URL(source, location.href);
    if (url.protocol === 'blob:') {
      if (url.origin !== location.origin) throw new Error('无法读取跨站图片');
      const controller = new AbortController();
      activeRequest = controller;
      try {
        const response = await fetch(url.href, { signal: controller.signal });
        if (!response.ok) throw new Error('图片读取失败');
        const blob = await response.blob();
        if (blob.size > 8 * 1024 * 1024) throw new Error('图片超过 8 MiB');
        return imageDataUrl(await blob.arrayBuffer());
      } finally { if (activeRequest === controller) activeRequest = null; }
    }
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'chaoxing.com' || url.hostname.endsWith('.chaoxing.com'))) throw new Error('图片来源不受支持，请手动处理');
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        activeRequest = null;
        rejectRequest = null;
        callback(value);
      };
      rejectRequest = () => finish(reject, new Error('手动暂停'));
      activeRequest = GM_xmlhttpRequest({
        method: 'GET', url: url.href, responseType: 'arraybuffer', timeout: 30000,
        onprogress: event => {
          if (event.loaded <= 8 * 1024 * 1024) return;
          const requestHandle = activeRequest;
          finish(reject, new Error('图片超过 8 MiB'));
          if (requestHandle) requestHandle.abort();
        },
        onload: response => {
          try {
            const finalUrl = new URL(response.finalUrl || url.href);
            if (finalUrl.protocol !== 'https:' || !(finalUrl.hostname === 'chaoxing.com' || finalUrl.hostname.endsWith('.chaoxing.com'))) throw new Error('图片重定向到不受支持的来源');
            if (response.status < 200 || response.status >= 300 || !response.response) throw new Error('图片读取失败');
            finish(resolve, imageDataUrl(response.response));
          } catch (error) { finish(reject, error); }
        },
        onerror: () => finish(reject, new Error('图片读取失败')),
        ontimeout: () => finish(reject, new Error('图片读取超时')),
        onabort: () => finish(reject, new Error('手动暂停'))
      });
    });
  }

  function assertRunning(token) {
    if (!running || token !== generation) throw new Error('手动暂停');
  }

  function parseQuestion(root) {
    const title = root.querySelector('.splitS-left .mark_name, .Zy_TItle .clearfix, .Zy_TItle, .mark_name');
    if (!title) throw new Error('无法识别题干');
    if (root.querySelector('.font-cxsecret') || root.classList.contains('font-cxsecret')) throw new Error('题目使用加密字体，暂无法读取正确题干');
    if (title.matches('.font-cxsecret') || title.querySelector('video, audio, canvas, svg, .font-cxsecret')) throw new Error('题干含不支持的媒体或混淆内容');
    const images = [];
    const collectImages = (element, label) => {
      const found = [...element.querySelectorAll('img')];
      found.forEach((image, index) => {
        const src = image.currentSrc || image.getAttribute('src');
        if (!src) throw new Error('题目图片缺少地址');
        images.push({ label: label + '图片' + (index + 1), src: new URL(src, image.baseURI).href });
      });
      return found.length;
    };
    const titleImageCount = collectImages(title, '题干');
    const stem = clean(title.textContent);
    if ((!stem && !titleImageCount) || stem.length > 20000) throw new Error('题干为空或过长');
    const typeInputs = [...root.querySelectorAll('input[id^="answertype"]')];
    const typeValue = (typeInputs.find(el => /type\d+/.test(el.name)) || typeInputs[0])?.value;
    let type;
    if (typeValue !== undefined) type = ({ '0': 'single', '1': 'multiple', '3': 'judge', '2': 'text', '4': 'text', '5': 'text', '6': 'text', '7': 'text', '8': 'text', '9': 'text', '10': 'text' })[typeValue];
    else if (/多选/.test(stem)) type = 'multiple';
    else if (/单选/.test(stem)) type = 'single';
    else if (/判断/.test(stem)) type = 'judge';
    else if (/填空|简答|论述|问答/.test(stem)) type = 'text';
    if (!type) throw new Error('不支持的题型');
    const numberMatch = stem.match(/^\s*(\d+)\s*[.、．)）]/) || clean(root.querySelector('.Zy_TItle > i')?.textContent).match(/^(\d+)$/);
    const number = numberMatch ? Number(numberMatch[1]) : null;
    const id = root.dataset.questionid || root.getAttribute('questionid') || root.id || typeInputs[0]?.id.replace(/^answertype/, '') || '';
    let choices = [];
    let inputs = [];
    if (type === 'text') {
      inputs = [...root.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]')].filter(el => visible(el) && !el.disabled && !el.readOnly);
      if (!inputs.length) throw new Error('找不到可编辑的答题框');
    } else {
      const controls = [...root.querySelectorAll('input[type="radio"], input[type="checkbox"]')].filter(el => !el.disabled && visible(el.closest('label, li') || el.parentElement));
      if (controls.length) {
        choices = controls.map((input, index) => {
          const container = input.closest('label, li') || input.parentElement;
          if (container.querySelector('canvas, video, audio, svg, .font-cxsecret')) throw new Error('选项含不支持的媒体或混淆内容');
          const key = String.fromCharCode(65 + index);
          const imageCount = collectImages(container, '选项' + key);
          return { key, text: clean(container.textContent).replace(/^[A-Z][.、．)）:]\s*/, ''), imageCount, input, container };
        });
      } else {
        choices = [...root.querySelectorAll('.answerBg .answer_p, .Zy_ulTop > li .after')].filter(visibleOptionText).map((element, index) => {
          if (element.querySelector('canvas, video, audio, svg, .font-cxsecret')) throw new Error('选项含不支持的媒体或混淆内容');
          const key = String.fromCharCode(65 + index);
          const imageCount = collectImages(element, '选项' + key);
          const container = element.closest('.Zy_ulTop > li') || element.parentElement;
          return { key, text: clean(element.textContent).replace(/^[A-Z][.、．)）:]\s*/, ''), imageCount, container, element: container.matches('.Zy_ulTop > li') ? container : element };
        });
      }
      if (choices.length < 2 || choices.length > 26 || choices.some(c => !c.text && !c.imageCount)) throw new Error('无法识别完整选项');
    }
    if (images.length > 12) throw new Error('单题图片超过 12 张，请手动处理');
    return { root, title, stem, type, number, id, choices, inputs, images, signature: JSON.stringify([id, number, stem, type, inputs.length, choices.map(c => c.text), images]) };
  }

  function selected(choice) {
    if (choice.input) return choice.input.checked;
    return !!choice.container.querySelector('[class*="check_answer"], [aria-checked="true"]') || choice.container.getAttribute('aria-checked') === 'true';
  }

  function resolveChoice(question, answer) {
    const value = clean(answer);
    let matches = question.choices.filter(c => c.key === value.toUpperCase());
    if (!matches.length) matches = question.choices.filter(c => clean(c.text) === value);
    if (!matches.length && question.type === 'judge') {
      const truth = /^(正确|对|是|true|√)$/i.test(value) ? true : /^(错误|错|否|false|×)$/i.test(value) ? false : null;
      if (truth !== null) matches = question.choices.filter(c => (truth ? /^(正确|对|是|true|√)$/i : /^(错误|错|否|false|×)$/i).test(clean(c.text)));
    }
    if (matches.length !== 1) throw new Error('模型答案无法唯一匹配选项');
    return matches[0];
  }

  function fill(question, result) {
    if (!Array.isArray(result.answers) || !result.answers.length || result.answers.some(x => typeof x !== 'string' || !x.trim())) throw new Error('模型答案格式不完整');
    if (result.needs_review === true) throw new Error('模型要求人工检查');
    if (question.type === 'text') {
      if (result.answers.length !== question.inputs.length) throw new Error('答案数量与填空数量不一致');
      for (let i = 0; i < question.inputs.length; i++) {
        const input = question.inputs[i];
        if (input.isContentEditable) input.textContent = result.answers[i];
        else input.value = result.answers[i];
        const InputEvent = input.ownerDocument.defaultView.Event;
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        input.dispatchEvent(new InputEvent('change', { bubbles: true }));
      }
      return () => question.root.isConnected && question.inputs.every((input, i) => input.isConnected && question.root.contains(input) && (input.isContentEditable ? input.textContent : input.value) === result.answers[i]);
    }
    const targets = result.answers.map(answer => resolveChoice(question, answer));
    if (new Set(targets).size !== targets.length || (question.type !== 'multiple' && targets.length !== 1)) throw new Error('选项数量不正确');
    for (const choice of question.choices) {
      if (selected(choice) !== targets.includes(choice)) {
        if (choice.input) choice.input.click();
        else choice.element.click();
      }
    }
    return () => question.root.isConnected && question.choices.every(choice => choice.container.isConnected && question.root.contains(choice.container) && (!choice.input || (choice.input.isConnected && question.root.contains(choice.input))) && selected(choice) === targets.includes(choice));
  }

  function usableButtons(pattern, doc) {
    return [...doc.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], .nextBtn, .submitBtn')]
      .filter(el => visible(el) && !el.disabled && !el.classList.contains('disabled') && el.getAttribute('aria-disabled') !== 'true' && pattern.test(clean(el.value || el.textContent)));
  }

  function nextButton(doc) {
    const known = [...doc.querySelectorAll('[onclick="getTheNextQuestion(1)"]')].filter(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled'));
    const candidates = known.length ? known : usableButtons(/^(下一题|下一页)$/, doc);
    if (candidates.length > 1) throw new Error('发现多个下一题按钮');
    return candidates[0];
  }

  async function run() {
    if (running) return;
    saveSettings();
    const token = ++generation;
    lock(true);
    try {
      if (/\/exam(?:-ans)?\//i.test(location.pathname)) throw new Error('考试页面不属于作业适配范围');
      if (!settings.apiKey || !settings.model) throw new Error('请配置 API Key 和模型');
      if (settings.autoSubmit && (!Number.isInteger(settings.expectedTotal) || settings.expectedTotal < 1)) throw new Error('自动提交需要填写作业总题数');
      const questionDocument = await findQuestionDocument(token);
      const seen = new Map();
      const pages = new Set();
      while (true) {
        assertRunning(token);
        if (!frameDocuments().documents.includes(questionDocument)) throw new Error('作业页面已切换，请重新开始');
        const current = rootsIn(questionDocument);
        if (!current.length) throw new Error('当前页面未识别到作业题目');
        const questions = current.map(parseQuestion);
        const pageKey = questions.map(q => q.signature).join('|');
        if (pages.has(pageKey)) throw new Error('页面未变化或出现重复题目');
        pages.add(pageKey);
        for (const q of questions) {
          assertRunning(token);
          if (q.number && seen.has(q.number)) throw new Error('题号重复');
          setStatus('正在请求第 ' + (q.number || seen.size + 1) + ' 题');
          const payload = { question: q.stem, type: q.type, options: q.choices.map(c => ({ key: c.key, text: c.text })), blank_count: q.inputs.length };
          let userContent = JSON.stringify(payload);
          if (q.images.length) {
            if (settings.model === 'deepseek-v4-pro') throw new Error('所选模型不支持图片，请选择 deepseek-flash');
            userContent = [{ type: 'text', text: JSON.stringify(payload) }];
            // A conservative bound for UTF-8 question text plus ASCII base64 payloads.
            let contentLength = userContent[0].text.length * 3;
            for (const image of q.images) {
              assertRunning(token);
              const url = await readImage(image.src);
              assertRunning(token);
              if (!q.root.isConnected || parseQuestion(q.root).signature !== q.signature) throw new Error('答题过程中页面发生变化');
              contentLength += url.length + image.label.length + 128;
              if (contentLength > 32 * 1024 * 1024) throw new Error('单题图片内容过大，请手动处理');
              userContent.push({ type: 'text', text: image.label }, { type: 'image_url', image_url: { url } });
            }
          }
          const result = await completion([
            { role: 'system', content: '解答课程作业。仅输出 JSON 对象，格式 {"answers":["A"],"needs_review":false,"reason":"简短依据"}。选择题 answers 用选项字母，多选每个字母单独一项。填空或简答按顺序给出每个文本框答案。信息不足或无法判断时 needs_review 为 true。' },
            { role: 'user', content: userContent }
          ]);
          assertRunning(token);
          if (!frameDocuments().documents.includes(questionDocument)) throw new Error('作业页面已切换，请重新开始');
          if (!q.root.isConnected) throw new Error('答题过程中页面发生变化');
          const currentQuestion = parseQuestion(q.root);
          if (currentQuestion.signature !== q.signature) throw new Error('答题过程中页面发生变化');
          const verify = fill(currentQuestion, result);
          await wait(120);
          assertRunning(token);
          if (!verify()) throw new Error('页面未确认填答状态');
          if (q.type === 'text') {
            const saveButtons = [...q.root.querySelectorAll('[onclick*="saveQuestion"]')].filter(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (saveButtons.length > 1) throw new Error('发现多个文本保存按钮，请手动处理');
            if (saveButtons.length === 1) {
              saveButtons[0].click();
              await wait(300);
              assertRunning(token);
              if (!q.root.isConnected || !verify()) throw new Error('保存后答题内容发生变化');
            }
          }
          seen.set(q.number || 'id:' + (q.id || q.signature), { question: q, verify });
          setStatus('已填写 ' + seen.size + ' 题');
          if (settings.delayMs) await wait(settings.delayMs);
        }
        assertRunning(token);
        const next = settings.autoNext && nextButton(questionDocument);
        if (next) {
          next.click();
          let changed = false;
          for (let i = 0; i < 150; i++) {
            await wait(100);
            assertRunning(token);
            if (!frameDocuments().documents.includes(questionDocument)) throw new Error('作业页面已刷新，请重新开始');
            const newRoots = rootsIn(questionDocument);
            try { changed = !!newRoots.length && newRoots.map(parseQuestion).map(q => q.signature).join('|') !== pageKey; } catch { changed = false; }
            if (changed) break;
          }
          if (!changed) throw new Error('翻页后题目未变化');
          continue;
        }
        if (settings.autoSubmit) {
          if (seen.size !== settings.expectedTotal || [...seen.keys()].some(k => typeof k !== 'number') || Array.from({ length: settings.expectedTotal }, (_, i) => i + 1).some(n => !seen.has(n))) throw new Error('题号或总题数不完整，未提交');
          if (questions.some(q => !seen.get(q.number)?.verify())) throw new Error('当前页面答案发生变化，未提交');
          const buttons = usableButtons(/^(提交|提交作业)$/, questionDocument);
          if (buttons.length !== 1) throw new Error('未找到唯一的提交按钮');
          buttons[0].click();
          for (let i = 0; i < 8; i++) {
            await wait(100);
            assertRunning(token);
            const dialogs = [...questionDocument.querySelectorAll('[role="dialog"], .layui-layer-dialog, #submitConfirm')].filter(visible).filter(el => /提交/.test(clean(el.textContent)));
            const confirmations = dialogs.flatMap(dialog => [...dialog.querySelectorAll('button, a, input[type="button"]')].filter(el => visible(el) && !el.disabled && /^(确定|确认提交|确认)$/.test(clean(el.value || el.textContent))));
            if (confirmations.length > 1) throw new Error('发现多个提交确认按钮，请手动处理');
            if (confirmations.length === 1) { confirmations[0].click(); break; }
          }
          setStatus('已点击提交，请查看页面确认结果');
        } else setStatus('当前页面填答完成，请检查作业及提交状态');
        break;
      }
    } catch (error) {
      if (token === generation) setStatus('已暂停：' + (error.message || '未知错误'));
    } finally {
      if (token === generation) lock(false);
    }
  }

  function stop() {
    generation++;
    if (activeRequest) activeRequest.abort();
    if (rejectRequest) rejectRequest();
    lock(false);
    setStatus('手动暂停');
  }

  function diagnosticReport() {
    const { documents, frames } = frameDocuments();
    const candidates = documents.flatMap(doc => [...doc.querySelectorAll('.TiMu, .questionLi')].filter(visible));
    const questionRoots = roots();
    return { page: location.origin + location.pathname, title: document.title, questionCount: questionRoots.length,
      documentCount: documents.length, frames,
      documents: documents.map(doc => ({ page: doc.location.origin + doc.location.pathname, questionCount: rootsIn(doc).length })),
      candidateCount: candidates.length, excludedContainerCount: candidates.length - questionRoots.length,
      questions: questionRoots.map(root => ({ className: root.className, hasTitle: !!root.querySelector('.Zy_TItle, .mark_name'),
        controls: root.querySelectorAll('input, textarea, [contenteditable]').length,
        choiceElements: root.querySelectorAll('input[type="radio"], input[type="checkbox"], .answerBg .answer_p, .Zy_ulTop > li .after').length,
        encryptedFont: root.matches('.font-cxsecret') || !!root.querySelector('.font-cxsecret'),
        hasTypeInput: !!root.querySelector('input[id^="answertype"]') })) };
  }

  function diagnostic() {
    const report = diagnosticReport();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chaoxing-diagnostic.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function mount() {
    if (document.getElementById('cxds-panel') || !document.body) return;
    if (!roots().length && !/work|homework|studentstudy|knowledge\/cards/i.test(location.pathname)) return;
    const host = document.createElement('div');
    host.id = 'cxds-panel';
    document.body.append(host);
    panel = host.attachShadow({ mode: 'open' });
    panel.innerHTML = PANEL_HTML;
    for (const image of panel.querySelectorAll('img[data-art]')) {
      image.onerror = () => {
        image.hidden = true;
        if (image.dataset.role === 'mascot') panel.querySelector('.fallback').hidden = false;
      };
      image.onload = () => {
        image.hidden = false;
        if (image.dataset.role === 'mascot') panel.querySelector('.fallback').hidden = true;
      };
      image.src = ART[image.dataset.art];
    }
    panel.querySelector('[data-role="connection"]').open = !settings.apiKey;
    const box = panel.querySelector('.box');
    const collapse = panel.querySelector('.collapse');
    const dock = panel.querySelector('.dock');
    const setCollapsed = collapsed => {
      box.hidden = collapsed;
      dock.hidden = !collapsed;
      collapse.setAttribute('aria-expanded', String(!collapsed));
      dock.setAttribute('aria-expanded', String(!collapsed));
      (collapsed ? dock : collapse).focus({ preventScroll: true });
    };
    collapse.onclick = () => setCollapsed(true);
    dock.onclick = () => setCollapsed(false);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !box.hidden) { event.preventDefault(); setCollapsed(true); }
    });
    for (const button of panel.querySelectorAll('.pose[data-pose]')) button.onclick = () => { if (!running) showPose(button.dataset.pose, true); };
    statusNode = panel.querySelector('[data-role="status"]');
    logNode = panel.querySelector('[data-role="log"]');
    syncCompanion('等待开始');
    for (const name of ['model', 'expectedTotal', 'delayMs']) field(name).value = settings[name];
    for (const name of ['autoNext', 'autoSubmit']) field(name).checked = settings[name];
    action('save').onclick = () => { saveSettings(); setStatus('设置已保存'); };
    action('clearKey').onclick = () => { settings.apiKey = ''; field('apiKey').value = ''; GM_setValue(SETTINGS, { ...settings }); setStatus('Key 已清除'); };
    action('start').onclick = run;
    action('stop').onclick = stop;
    action('diagnostic').onclick = diagnostic;
    action('models').onclick = async () => {
      if (running) return;
      const token = ++generation;
      lock(true);
      try {
        saveSettings();
        const data = await request('GET', '/models');
        assertRunning(token);
        const models = (data.data || []).map(item => item.id).filter(id => typeof id === 'string' && id);
        if (!models.length) throw new Error('模型列表为空');
        const list = panel.querySelector('#cxds-models');
        list.replaceChildren(...models.map(id => { const option = document.createElement('option'); option.value = id; option.textContent = id; return option; }));
        if (!models.includes(settings.model)) field('model').value = models[0];
        setStatus('读取模型成功：' + models.join('、'));
      } catch (error) { if (token === generation) setStatus('已暂停：' + error.message); }
      finally { if (token === generation) lock(false); }
    };
    action('test').onclick = async () => {
      if (running) return;
      const token = ++generation;
      lock(true);
      try { saveSettings(); await completion([{ role: 'user', content: '请只返回 JSON 对象 {"ok":true}。' }]); assertRunning(token); setStatus('连接测试成功'); }
      catch (error) { if (token === generation) setStatus('已暂停：' + error.message); }
      finally { if (token === generation) lock(false); }
    };
  }

  mount();
  if (!panel) {
    const observer = new MutationObserver(() => { mount(); if (panel) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
