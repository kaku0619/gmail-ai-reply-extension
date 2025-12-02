const REPLY_BODY_SELECTORS = [
  'div[aria-label="Message body"]', // en
  'div[aria-label="メッセージ本文"]', // ja
  'div[aria-label="メッセージを入力"]', // ja variant
  'div[aria-label="メール本文"]', // ja variant
  'div[role="textbox"][g_editable="true"]' // fallback: Gmail editable textbox
];
const MESSAGE_CONTAINER_SELECTORS = [
  'div[role="listitem"]',
  'div.if', // conversation item wrapper
  'div.adn' // legacy conversation item
];

function findReplyEditors() {
  const nodes = REPLY_BODY_SELECTORS.flatMap(sel =>
    Array.from(document.querySelectorAll(sel))
  );
  return Array.from(new Set(nodes));
}

function isElementVisible(el) {
  if (!el) return false;
  const { offsetParent, offsetWidth, offsetHeight } = el;
  return !!(offsetParent || offsetWidth || offsetHeight);
}

function findTargetEditor() {
  const editors = findReplyEditors().filter(isElementVisible);
  if (!editors.length) return null;
  const active = document.activeElement;
  const activeEditor = editors.find(ed => ed.contains(active) || ed === active);
  return activeEditor || editors[editors.length - 1];
}

function sanitizeText(text = '', limit = 2000) {
  const trimmed = text.replace(/\s+\n/g, '\n').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function findMessageContainerFromEditor(editor) {
  let node = editor;
  while (node && node !== document.body) {
    if (MESSAGE_CONTAINER_SELECTORS.some(sel => node.matches?.(sel))) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function pickLatest(list) {
  return list.length ? list[list.length - 1] : undefined;
}

function extractBodyFromContainer(container) {
  const bodyNode = container.querySelector('div.a3s');
  if (!bodyNode) return null;
  const text = bodyNode.innerText || '';
  return text.trim() ? text.trim() : null;
}

function extractSenderFromContainer(container) {
  const senderNode =
    container.querySelector('span.gD') || container.querySelector('span[email]');
  return senderNode?.textContent?.trim() || 'Unknown';
}

function getContextFromEditor(editor) {
  const subject =
    document.querySelector('h2.hP')?.textContent?.trim() || 'No subject';
  const container = findMessageContainerFromEditor(editor);

  if (container) {
    const body = extractBodyFromContainer(container);
    return {
      subject,
      latestSender: extractSenderFromContainer(container),
      body: body || '',
      snippet: body || 'No body text found'
    };
  }

  // Fallback: last visible message in thread
  const bodyNodes = Array.from(
    document.querySelectorAll('div[role="listitem"] div.a3s')
  );
  const visibleBodies = bodyNodes.filter(node => sanitizeText(node.innerText).length);
  const latest = pickLatest(visibleBodies);
  const body = latest ? latest.innerText.trim() : '';
  const senderNodes = Array.from(
    document.querySelectorAll('div[role="listitem"] span.gD')
  );
  const latestSender = pickLatest(senderNodes)?.textContent?.trim() || 'Unknown';

  return {
    subject,
    latestSender,
    body,
    snippet: body || 'No body text found'
  };
}

function getConversationContext() {
  const editor = findTargetEditor();
  if (!editor) return null;
  return getContextFromEditor(editor);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CHECK_REPLY_CONTEXT') {
    const context = getConversationContext();
    sendResponse({
      hasReplyOpen: !!context,
      context
    });
  }
});
