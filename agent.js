require('dotenv').config();

/**
 * Clean and validate phone numbers using basic regex logic.
 * Assumes Egypt (+20) if no country code is present.
 * @param {string[]} rawNumbers
 * @returns {{ valid: string[], invalid: string[], report: string }}
 */
function validateNumbers(rawNumbers) {
  const valid = [];
  const invalid = [];

  for (const raw of rawNumbers) {
    const cleaned = raw.replace(/\D/g, '');
    if (cleaned.length >= 7) {
      let formatted = cleaned;
      if (formatted.startsWith('00')) {
        formatted = '+' + formatted.slice(2);
      } else if (formatted.startsWith('0')) {
        formatted = '+20' + formatted.slice(1);
      } else if (!formatted.startsWith('+')) {
        formatted = '+20' + formatted;
      }
      if (formatted.length >= 10 && formatted.length <= 15) {
        valid.push(formatted);
      } else {
        invalid.push(raw);
      }
    } else {
      invalid.push(raw);
    }
  }

  return {
    valid,
    invalid,
    report: `${valid.length} valid numbers, ${invalid.length} invalid numbers found.`,
  };
}

/**
 * Get a safe bulk-sending strategy based on list size.
 * @param {number} totalCount
 * @returns {{ delayMs: number, batchSize: number, batchPauseMs: number, advice: string }}
 */
function getSendStrategy(totalCount) {
  let delayMs = 5000;
  let batchSize = 50;
  let batchPauseMs = 60000;

  if (totalCount > 200) {
    delayMs = 8000;
    batchSize = 30;
    batchPauseMs = 120000;
  } else if (totalCount > 100) {
    delayMs = 6000;
    batchSize = 40;
    batchPauseMs = 90000;
  }

  return {
    delayMs,
    batchSize,
    batchPauseMs,
    advice: `Sending to ${totalCount} contacts. Using safe defaults (${delayMs / 1000}s delay, ${batchSize} per batch).`,
  };
}

module.exports = {
  validateNumbers,
  getSendStrategy,
};
