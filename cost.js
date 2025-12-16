// Lightweight cost helpers for token estimation and pricing.
const PRICE_INPUT_PER_M = 0.25; // USD per 1M tokens (gpt-5-mini input)
const PRICE_OUTPUT_PER_M = 2.00; // USD per 1M tokens (gpt-5-mini output)
const AVG_CHARS_PER_TOKEN = 4;
const USD_TO_JPY = 150;

function estimateTokens(text = '') {
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

// Expose to popup.js (non-module environment)
window.estimateTokens = estimateTokens;
window.estimateCost = estimateCost;
window.USD_TO_JPY = USD_TO_JPY;
