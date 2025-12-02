const elements = {
  apiKey: document.getElementById('api-key'),
  senderName: document.getElementById('sender-name'),
  prompt: document.getElementById('prompt'),
  saveSettings: document.getElementById('save-settings'),
  toggleSnippet: document.getElementById('toggle-snippet'),
  emailSubject: document.getElementById('email-subject'),
  emailBody: document.getElementById('email-body'),
  emailSnippet: document.getElementById('email-snippet'),
  inputPreview: document.getElementById('input-preview'),
  draft: document.getElementById('draft'),
  copyStatus: document.getElementById('copy-status'),
  costInfo: document.getElementById('cost-info'),
  draftCard: document.getElementById('draft-card'),
  alertContainer: document.getElementById('alert-container'),
  draftSpinner: document.getElementById('draft-spinner'),
  draftStatus: document.getElementById('draft-status'),
  copy: document.getElementById('copy'),
  tabButtons: document.querySelectorAll('[data-tab-target]'),
  tabContents: document.querySelectorAll('.tab-content')
};

const SAVE_DEFAULT_LABEL = '保存';
const COPY_DEFAULT_LABEL = '生成結果をコピー';
const TOGGLE_LABEL_HIDDEN = '▶ 返信対象のメールを表示';
const TOGGLE_LABEL_SHOWN = '▼ 返信対象のメールを隠す';
const OVERLAY_DEFAULT_MESSAGE =
  'Gmailの返信ボックスを開いている状態で再度拡張機能を起動してください。';
const OVERLAY_SETTINGS_MESSAGE = '未入力の設定項目があります。';
const PRICE_INPUT_PER_M = 0.05; // USD per 1M tokens (gpt-5-nano input)
const PRICE_OUTPUT_PER_M = 0.4; // USD per 1M tokens (gpt-5-nano output)
const AVG_CHARS_PER_TOKEN = 4;
const USD_TO_JPY = 150;
const MODEL = 'gpt-5-nano';
const FETCH_TIMEOUT_MS = 15000;

let lastContext = null;
const iconCache = { default: null, available: null };
let isGenerating = false;
let autoGenerateTriggered = false;

function hasRequiredSettings() {
  const apiKey = elements.apiKey.value.trim();
  const senderName = elements.senderName.value.trim();
  const prompt = elements.prompt.value.trim();
  return !!(apiKey && senderName && prompt);
}

function addAlert(message) {
  const card = document.createElement('div');
  card.className = 'overlay';
  const icon = document.createElement('span');
  icon.className = 'alert-icon';
  icon.textContent = '⚠️';
  const text = document.createElement('p');
  text.className = 'alert-text';
  text.textContent = message;
  card.appendChild(icon);
  card.appendChild(text);
  elements.alertContainer.appendChild(card);
}

function showAlerts(messages = []) {
  elements.alertContainer.innerHTML = '';
  messages.forEach(msg => addAlert(msg));
}

function clearAlerts() {
  elements.alertContainer.innerHTML = '';
}

function showOverlayWithSettingsFallback(baseMessage, includeSettingsFallback = true) {
  const messages = [baseMessage];
  if (includeSettingsFallback && !hasRequiredSettings()) {
    messages.push(OVERLAY_SETTINGS_MESSAGE);
  }
  showAlerts(messages);
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

function estimateCost(promptText, userText, outputText) {
  const inputTokens = estimateTokens(promptText) + estimateTokens(userText);
  const outputTokens = estimateTokens(outputText);
  const inputCost = (inputTokens / 1_000_000) * PRICE_INPUT_PER_M;
  const outputCost = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
  return {
    inputTokens,
    outputTokens,
    totalUsd: inputCost + outputCost
  };
}

function resetSnippet() {
  elements.inputPreview.classList.add('hidden');
  elements.emailSnippet.classList.add('hidden');
  elements.toggleSnippet.textContent = TOGGLE_LABEL_HIDDEN;
}

function resetCopyButton(show = false) {
  elements.copy.textContent = COPY_DEFAULT_LABEL;
  elements.copy.classList.remove('success');
  elements.copy.disabled = !show;
  elements.copy.classList.toggle('hidden', !show);
}

function resetOutput() {
  clearAlerts();
  elements.draft.textContent = '';
  elements.copyStatus.textContent = '';
  elements.costInfo.textContent = '';
  elements.draftSpinner.classList.add('hidden');
  elements.draftStatus.classList.add('hidden');
  resetCopyButton(false);
  resetSnippet();
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(['apiKey', 'prompt', 'senderName']);
  elements.apiKey.value = stored.apiKey || '';
  elements.prompt.value = stored.prompt || DEFAULT_PROMPT;
  elements.senderName.value = stored.senderName || '';
  maybeAutoGenerate();
}

async function saveSettings() {
  await chrome.storage.sync.set({
    apiKey: elements.apiKey.value.trim(),
    senderName: elements.senderName.value.trim(),
    prompt: elements.prompt.value.trim() || DEFAULT_PROMPT
  });
  elements.saveSettings.textContent = '保存しました ✔';
  elements.saveSettings.classList.add('success');
  setTimeout(() => {
    elements.saveSettings.textContent = SAVE_DEFAULT_LABEL;
    elements.saveSettings.classList.remove('success');
  }, 1600);
}

function disableGeneration(message, alertMessage = OVERLAY_DEFAULT_MESSAGE, includeSettings = true) {
  isGenerating = false;
  if (message) {
    elements.emailBody.textContent = message;
  }
  resetOutput();
  showOverlayWithSettingsFallback(alertMessage, includeSettings);
}

function enableGeneration() {
}

function createIconData(color) {
  const sizes = [16, 32];
  const images = {};

  sizes.forEach(size => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(size * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', size / 2, size / 2 + 1);
    images[size] = ctx.getImageData(0, 0, size, size);
  });

  return images;
}

function setIcon(available) {
  const key = available ? 'available' : 'default';
  if (!iconCache[key]) {
    iconCache[key] = createIconData(available ? '#2f6bff' : '#c1c7d0');
  }
  chrome.action.setIcon({ imageData: iconCache[key] });
}

function maybeAutoGenerate() {
  if (autoGenerateTriggered) return;
  if (isGenerating) return;
  if (!hasRequiredSettings()) return;
  if (!lastContext) return;
  autoGenerateTriggered = true;
  generateDraft();
}

function switchTab(target) {
  elements.tabButtons.forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tabTarget === target)
  );
  elements.tabContents.forEach(section =>
    section.classList.toggle('active', section.dataset.tab === target)
  );
}

function getActiveGmailTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      const isGmail = tab?.url?.includes('mail.google.com');
      resolve(isGmail ? tab : null);
    });
  });
}

function sendMessageToTab(tabId, payload) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, payload, response => {
      if (chrome.runtime.lastError) {
        console.warn('sendMessage error:', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

function ensureContentScript(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ['contentScript.js']
  });
}

function buildUserPayload(context) {
  if (!context) return '';
  return [
    `件名: ${context.subject}`,
    `差出人: ${context.latestSender}`,
    '本文:',
    context.body || '(本文なし)'
  ].join('\n');
}

async function checkContext() {
  const tab = await getActiveGmailTab();
  if (!tab) {
    elements.emailSubject.textContent = '件名: -';
    elements.emailBody.textContent = '';
    disableGeneration();
    setIcon(false);
    return;
  }

  let response = await sendMessageToTab(tab.id, { type: 'CHECK_REPLY_CONTEXT' });

  // If the content script is not yet injected (e.g., Gmail already open before install), inject and retry.
  if (!response) {
    try {
      await ensureContentScript(tab.id);
      response = await sendMessageToTab(tab.id, { type: 'CHECK_REPLY_CONTEXT' });
    } catch (e) {
      console.error('Failed to inject content script', e);
    }
  }

  if (!response) {
    elements.emailSubject.textContent = '件名: -';
    elements.emailBody.textContent = '';
    disableGeneration();
    setIcon(false);
    return;
  }

  if (!response.context) {
    lastContext = null;
    elements.emailSubject.textContent = '件名: -';
    elements.emailBody.textContent = '';
    disableGeneration();
    setIcon(false);
    return;
  }

  lastContext = response.context;
  autoGenerateTriggered = false;
  elements.emailSubject.textContent = `件名: ${lastContext.subject}`;
  elements.emailBody.textContent = lastContext.body || '本文が取得できませんでした。';

  if (response.hasReplyOpen) {
    setIcon(true);
    clearAlerts();
    elements.copy.disabled = false;
    elements.copy.classList.add('hidden');
    elements.inputPreview.classList.add('hidden');
    if (!hasRequiredSettings()) {
      disableGeneration(undefined, OVERLAY_SETTINGS_MESSAGE, false);
      return;
    }
    maybeAutoGenerate();
  } else {
    elements.emailBody.textContent = '返信欄が開いていません。';
    disableGeneration();
    setIcon(false);
    elements.copyStatus.textContent = '';
    elements.copy.disabled = true;
  }
}

async function generateDraft() {
  if (!lastContext) return;
  if (!hasRequiredSettings()) {
    disableGeneration(undefined, OVERLAY_SETTINGS_MESSAGE, false);
    return;
  }
  const apiKey = elements.apiKey.value.trim();
  const senderName = elements.senderName.value.trim();
  const prompt = elements.prompt.value.trim() || DEFAULT_PROMPT;
  if (!apiKey) {
    showOverlayWithSettingsFallback(OVERLAY_SETTINGS_MESSAGE);
    return;
  }

  isGenerating = true;
  resetOutput();
  elements.draftSpinner.classList.remove('hidden');
  elements.draftStatus.classList.remove('hidden');

  const payload = {
    model: MODEL,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              BASE_SYSTEM_INSTRUCTIONS,
              prompt,
              '以下の情報を踏まえて日本語で丁寧かつ簡潔な返信文を作成してください。',
              '件名は返信文に含めないでください。',
              '敬称・署名を適宜含め、箇条書きが有用なら活用してください。',
              senderName
                ? `署名には送信者として「${senderName}」を含めてください。`
                : '署名は一般的な形式でまとめてください。'
            ].join('\n')
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: buildUserPayload(lastContext)
          }
        ]
      }
    ],
    reasoning: { effort: 'minimal' },
    max_output_tokens: 600
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const draftText =
      typeof data?.output_text === 'string' && data.output_text.trim()
        ? data.output_text.trim()
        : Array.isArray(data?.output)
          ? data.output
            .flatMap(item =>
              (item?.content || [])
                .filter(part => part?.type === 'output_text' && part.text)
                .map(part => part.text)
            )
            .join('\n\n')
            .trim()
          : '';
    if (!draftText) {
      throw new Error('返信案を取得できませんでした。');
    }

    elements.draft.textContent = draftText;
    elements.copyStatus.textContent = '';
  } catch (err) {
    console.error(err);
    elements.copyStatus.textContent = err.message || '生成に失敗しました';
  } finally {
    isGenerating = false;
    elements.draftSpinner.classList.add('hidden');
    elements.draftStatus.classList.add('hidden');
    elements.copy.disabled = false;
    if (elements.draft.textContent && lastContext) {
      elements.copy.classList.remove('hidden');
      elements.inputPreview.classList.remove('hidden');
      const userPayload = buildUserPayload(lastContext);
      const cost = estimateCost(prompt, userPayload, elements.draft.textContent);
      const totalJpy = cost.totalUsd * USD_TO_JPY;
      elements.costInfo.textContent = `推定コスト: 約${totalJpy.toFixed(3)}円`;
    }
  }
}

async function copyDraft() {
  if (!elements.draft.textContent) return;
  try {
    await navigator.clipboard.writeText(elements.draft.textContent);
    elements.copy.textContent = 'コピーしました ✔';
    elements.copy.classList.add('success');
    setTimeout(() => {
      elements.copy.textContent = COPY_DEFAULT_LABEL;
      elements.copy.classList.remove('success');
    }, 1600);
  } catch (err) {
    elements.copy.textContent = 'コピーに失敗しました';
    elements.copy.classList.remove('success');
  }
}

function toggleSnippet() {
  const hidden = elements.emailSnippet.classList.toggle('hidden');
  elements.toggleSnippet.textContent = hidden ? TOGGLE_LABEL_HIDDEN : TOGGLE_LABEL_SHOWN;
}

function init() {
  loadSettings();
  checkContext();
  elements.saveSettings.addEventListener('click', saveSettings);
  elements.toggleSnippet.addEventListener('click', toggleSnippet);
  elements.copy.addEventListener('click', copyDraft);
  elements.tabButtons.forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tabTarget))
  );
  setIcon(false);
}

document.addEventListener('DOMContentLoaded', init);
