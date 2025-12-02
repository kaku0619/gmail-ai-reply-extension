const elements = {
  replyStatus: document.getElementById('reply-status'),
  noticeCard: document.getElementById('notice-card'),
  noticeText: document.getElementById('notice-text'),
  apiKey: document.getElementById('api-key'),
  senderName: document.getElementById('sender-name'),
  prompt: document.getElementById('prompt'),
  saveSettings: document.getElementById('save-settings'),
  saveStatus: document.getElementById('save-status'),
  generate: document.getElementById('generate'),
  emailSubject: document.getElementById('email-subject'),
  emailSnippet: document.getElementById('email-snippet'),
  draft: document.getElementById('draft'),
  copy: document.getElementById('copy'),
  copyStatus: document.getElementById('copy-status'),
  draftCard: document.getElementById('draft-card'),
  tabButtons: document.querySelectorAll('[data-tab-target]'),
  tabContents: document.querySelectorAll('.tab-content')
};

const DEFAULT_PROMPT =
  'あなたは礼儀正しく、簡潔で親切なメール返信を作成するアシスタントです。' +
  '事実に忠実に、相手の要望を踏まえ、必要な場合は質問を1つまで含めます。' +
  '署名や挨拶を適宜含め、日本語で返信案を作ってください。';

let lastContext = null;
const iconCache = { default: null, available: null };

function setBadge(text) {
  elements.replyStatus.textContent = text;
}

function setNotice(text) {
  elements.noticeText.textContent = text;
  elements.noticeCard.classList.remove('hidden');
}

function hideNotice() {
  elements.noticeCard.classList.add('hidden');
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(['apiKey', 'prompt', 'senderName']);
  elements.apiKey.value = stored.apiKey || '';
  elements.prompt.value = stored.prompt || DEFAULT_PROMPT;
  elements.senderName.value = stored.senderName || '';
}

async function saveSettings() {
  await chrome.storage.sync.set({
    apiKey: elements.apiKey.value.trim(),
    senderName: elements.senderName.value.trim(),
    prompt: elements.prompt.value.trim() || DEFAULT_PROMPT
  });
  elements.saveStatus.textContent = '設定を保存しました';
  setTimeout(() => (elements.saveStatus.textContent = ''), 1600);
}

function disableGeneration(message) {
  elements.generate.disabled = true;
  elements.copy.disabled = true;
  if (message) {
    elements.emailSnippet.textContent = message;
  }
}

function enableGeneration() {
  elements.generate.disabled = false;
  elements.copy.disabled = false;
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
    setNotice('Gmailタブが見つかりません。Gmailを開いてからお試しください。');
    elements.emailSnippet.textContent = '';
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
    setBadge('未検出');
    setNotice('ページ読み込み後に再度お試しください。');
    elements.emailSnippet.textContent = '';
    disableGeneration();
    setIcon(false);
    return;
  }

  lastContext = response.context;
  elements.emailSubject.textContent = `件名: ${lastContext.subject}`;
  elements.emailSnippet.textContent = lastContext.body || '本文が取得できませんでした。';

  if (response.hasReplyOpen) {
    setBadge('返信欄あり');
    hideNotice();
    enableGeneration();
    setIcon(true);
  } else {
    setBadge('返信欄なし');
    setNotice('「返信」ボタンを押してから拡張機能を開くと下書きを作成できます。');
    elements.emailSnippet.textContent = '返信欄が開いていません。';
    disableGeneration();
    setIcon(false);
  }
}

async function generateDraft() {
  if (!lastContext) return;
  const apiKey = elements.apiKey.value.trim();
  const senderName = elements.senderName.value.trim();
  const prompt = elements.prompt.value.trim() || DEFAULT_PROMPT;
  if (!apiKey) {
    setNotice('APIキーを入力してください。');
    return;
  }

  elements.generate.disabled = true;
  elements.generate.textContent = '生成中…';
  elements.copyStatus.textContent = '';
  elements.draft.value = '';

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

    elements.draft.value = draftText;
    await navigator.clipboard.writeText(draftText);
    elements.copyStatus.textContent = '生成してコピーしました';
  } catch (err) {
    console.error(err);
    elements.copyStatus.textContent = err.message || '生成に失敗しました';
  } finally {
    elements.generate.disabled = false;
    elements.generate.textContent = '生成してコピー';
  }
}

async function copyDraft() {
  if (!elements.draft.value) return;
  await navigator.clipboard.writeText(elements.draft.value);
  elements.copyStatus.textContent = 'コピーしました';
  setTimeout(() => (elements.copyStatus.textContent = ''), 1200);
}

function init() {
  loadSettings();
  checkContext();
  elements.saveSettings.addEventListener('click', saveSettings);
  elements.generate.addEventListener('click', generateDraft);
  elements.copy.addEventListener('click', copyDraft);
  elements.tabButtons.forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tabTarget))
  );
  setIcon(false);
}

document.addEventListener('DOMContentLoaded', init);
