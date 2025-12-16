// Lightweight cost helpers for token estimation and pricing.
const PRICE_INPUT_PER_M = 0.25; // USD per 1M tokens (gpt-5-mini input)
const PRICE_OUTPUT_PER_M = 2.00; // USD per 1M tokens (gpt-5-mini output)
const USD_TO_JPY = 150;

function calculateCostFromUsage(usage) {
  if (!usage) {
    return null;
  }
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const inputCost = (inputTokens / 1_000_000) * PRICE_INPUT_PER_M;
  const outputCost = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M;
  return {
    inputTokens,
    outputTokens,
    totalUsd: inputCost + outputCost
  };
}

// Expose to popup.js (non-module environment)
window.calculateCostFromUsage = calculateCostFromUsage;
window.USD_TO_JPY = USD_TO_JPY;
