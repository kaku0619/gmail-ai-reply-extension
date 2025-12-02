const elements = {
  replyStatus: document.getElementById('reply-status'),
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

const DEFAULT_PROMPT =
  'あなたは礼儀正しく、簡潔で親切なメール返信を作成するアシスタントです。' +
  '事実に忠実に、相手の要望を踏まえ、必要な場合は質問を1つまで含めます。' +
  '署名や挨拶を適宜含め、日本語で返信案を作ってください。';
const SAVE_DEFAULT_LABEL = '保存';
const COPY_DEFAULT_LABEL = '生成結果をコピー';
const TOGGLE_LABEL_HIDDEN = '▶ 返信対象のメールを表示';
const TOGGLE_LABEL_SHOWN = '▼ 返信対象のメールを隠す';
const OVERLAY_DEFAULT_MESSAGE =
  'Gmailの返信ボックスを開いている状態で再度拡張機能を起動してください。';
const OVERLAY_SETTINGS_MESSAGE = '未入力の設定項目があります。';
const PRICE_INPUT_PER_K = 0.00015; // USD per 1K tokens (gpt-4o-mini input)
const PRICE_OUTPUT_PER_K = 0.0006; // USD per 1K tokens (gpt-4o-mini output)
const AVG_CHARS_PER_TOKEN = 4;
const USD_TO_JPY = 150;

let lastContext = null;
const iconCache = { default: null, available: null };
let isGenerating = false;
let autoGenerateTriggered = false;

function setBadge(text) {
  elements.replyStatus.textContent = text;
}

function setNotice(text) {
}

function hideNotice() {
}

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

function showOverlayWithSettingsFallback(baseMessage) {
  elements.alertContainer.innerHTML = '';
  addAlert(baseMessage);
  if (!hasRequiredSettings()) {
    addAlert(OVERLAY_SETTINGS_MESSAGE);
  }
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / AVG_CHARS_PER_TOKEN);
}

function formatUsd(value) {
  return `$${value.toFixed(6)}`;
}

function estimateCost(promptText, userText, outputText) {
  const inputTokens = estimateTokens(promptText) + estimateTokens(userText);
  const outputTokens = estimateTokens(outputText);
  const inputCost = (inputTokens / 1000) * PRICE_INPUT_PER_K;
  const outputCost = (outputTokens / 1000) * PRICE_OUTPUT_PER_K;
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
  elements.alertContainer.innerHTML = '';
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

function disableGeneration(message) {
  isGenerating = false;
  if (message) {
    elements.emailBody.textContent = message;
  }
  resetOutput();
  showOverlayWithSettingsFallback(OVERLAY_DEFAULT_MESSAGE);
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

async function checkContext() {
  const tab = await getActiveGmailTab();
  if (!tab) {
    setBadge('未検出');
    hideNotice();
    elements.emailSubject.textContent = '件名: -';
    elements.emailBody.textContent = '';
    disableGeneration();
    setIcon(false);
    showOverlayWithSettingsFallback(OVERLAY_DEFAULT_MESSAGE);
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
    setBadge('未検出');
    hideNotice();
    elements.emailSubject.textContent = '件名: -';
    elements.emailBody.textContent = '';
    disableGeneration();
    setIcon(false);
    showOverlayWithSettingsFallback(OVERLAY_DEFAULT_MESSAGE);
    return;
  }

  lastContext = response.context;
  autoGenerateTriggered = false;
  elements.emailSubject.textContent = `件名: ${lastContext.subject}`;
  elements.emailBody.textContent = lastContext.body || '本文が取得できませんでした。';

  if (response.hasReplyOpen) {
    setBadge('返信欄あり');
    hideNotice();
    enableGeneration();
    setIcon(true);
    elements.alertContainer.innerHTML = '';
    elements.copy.disabled = false;
    elements.copy.classList.add('hidden');
    elements.inputPreview.classList.add('hidden');
    if (!hasRequiredSettings()) {
      disableGeneration();
      showOverlay(OVERLAY_SETTINGS_MESSAGE);
      return;
    }
    maybeAutoGenerate();
  } else {
    setBadge('返信欄なし');
    hideNotice();
    elements.emailBody.textContent = '返信欄が開いていません。';
    disableGeneration();
    setIcon(false);
    showOverlayWithSettingsFallback(OVERLAY_DEFAULT_MESSAGE);
    elements.copyStatus.textContent = '';
    elements.copy.disabled = true;
  }
}

async function generateDraft() {
  if (!lastContext) return;
  if (!hasRequiredSettings()) {
    disableGeneration();
    showOverlay(OVERLAY_SETTINGS_MESSAGE);
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
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          `件名: ${lastContext.subject}`,
          `差出人: ${lastContext.latestSender}`,
          `自分の名前(署名用): ${senderName || '未設定'}`,
          '本文:',
          lastContext.body || '(本文なし)',
          '',
          '上記メールへの簡潔で丁寧な日本語の返信文を作成してください。',
          '返信文には件名を含めないでください。',
          '敬称・署名を適宜含め、箇条書きが有用なら活用してください。',
          senderName
            ? `返信文には送信者として「${senderName}」の名前を入れてください。`
            : '名前が未設定の場合は一般的な署名のままにしてください。'
        ].join('\n')
      }
    ],
    temperature: 0.7
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const draftText = data?.choices?.[0]?.message?.content?.trim();
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
    if (elements.draft.textContent) {
      elements.copy.classList.remove('hidden');
      elements.inputPreview.classList.remove('hidden');
      const userPayload = [
        `件名: ${lastContext.subject}`,
        `差出人: ${lastContext.latestSender}`,
        `自分の名前(署名用): ${senderName || '未設定'}`,
        '本文:',
        lastContext.body || '(本文なし)',
        '',
        '上記メールへの簡潔で丁寧な日本語の返信文を作成してください。',
        '返信文には件名を含めないでください。',
        '敬称・署名を適宜含め、箇条書きが有用なら活用してください。',
        senderName
          ? `返信文には送信者として「${senderName}」の名前を入れてください。`
          : '名前が未設定の場合は一般的な署名のままにしてください。'
      ].join('\n');
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
  elements.replyStatus.style.display = 'none';
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
