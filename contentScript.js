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
let lastHasReplyOpen = null;
let stateCheckTimer = null;

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

function formatSenderNode(node) {
  if (!node) return 'Unknown';
  const name = node.textContent?.trim();
  const email = node.getAttribute?.('email')?.trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || 'Unknown';
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
    container.querySelector('span.gD[email]') ||
    container.querySelector('span[email]') ||
    container.querySelector('span.gD');
  return formatSenderNode(senderNode);
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
  const visibleBodies = bodyNodes.filter(node => {
    const text = node?.innerText || '';
    return sanitizeText(text).length > 0;
  });
  const latest = pickLatest(visibleBodies);
  const body = latest?.innerText?.trim() || '';
  const senderNodes = Array.from(
    document.querySelectorAll(
      'div[role="listitem"] span.gD[email], div[role="listitem"] span[email], div[role="listitem"] span.gD'
    )
  );
  const latestSender = formatSenderNode(pickLatest(senderNodes));

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

function notifyReplyState(hasReplyOpen) {
  chrome.runtime.sendMessage({ type: 'REPLY_CONTEXT_STATE', hasReplyOpen });
}

function updateReplyState(context) {
  const hasReplyOpen = !!context;
  if (hasReplyOpen !== lastHasReplyOpen) {
    lastHasReplyOpen = hasReplyOpen;
    notifyReplyState(hasReplyOpen);
  }
}

function checkAndNotifyState() {
  const context = getConversationContext();
  updateReplyState(context);
  return context;
}

function setupReplyObserver() {
  const observer = new MutationObserver(() => {
    clearTimeout(stateCheckTimer);
    stateCheckTimer = setTimeout(checkAndNotifyState, 200);
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Initial state push
  checkAndNotifyState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CHECK_REPLY_CONTEXT') {
    const context = checkAndNotifyState();
    sendResponse({
      hasReplyOpen: !!context,
      context
    });
  }
});

setupReplyObserver();
