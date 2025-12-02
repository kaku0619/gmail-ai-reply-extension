const iconCache = { default: null, available: null };

function createIconData(color) {
  const sizes = [16, 32];
  const images = {};

  sizes.forEach(size => {
    const canvas = new OffscreenCanvas(size, size);
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

function setIcon(available, tabId) {
  const key = available ? 'available' : 'default';
  if (!iconCache[key]) {
    iconCache[key] = createIconData(available ? '#2f6bff' : '#c1c7d0');
  }

  const params = { imageData: iconCache[key] };
  if (typeof tabId === 'number') {
    params.tabId = tabId;
  }
  chrome.action.setIcon(params);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'REPLY_CONTEXT_STATE') {
    setIcon(message.hasReplyOpen, sender?.tab?.id);
  }
});

function initIcon() {
  // Set a default icon so Chrome doesn't fall back to a generic badge.
  setIcon(false);
}

chrome.runtime.onInstalled.addListener(initIcon);
chrome.runtime.onStartup.addListener(initIcon);
