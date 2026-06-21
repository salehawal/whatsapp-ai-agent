const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Clean and validate phone numbers using Claude.
 * Assumes Egypt (+20) if no country code is present.
 * @param {string[]} rawNumbers
 * @returns {Promise<{ valid: string[], invalid: string[], report: string }>}
 */
async function validateNumbers(rawNumbers) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `You are a phone number validator. Clean and validate these phone numbers to international format (E.164). Assume Egypt (+20) if no country code is present.

Rules:
- Remove all non-digit characters except leading +
- If a number starts with 0, replace the 0 with +20
- If a number starts with 1 or 2 digits and no +, prepend +20
- If a number already starts with +, keep as-is
- Valid numbers must be between 10 and 15 digits after the +
- Invalid numbers are those that cannot be reasonably converted

Return ONLY raw JSON with no markdown, no code fences, no extra text:
{
  "valid": ["+201234567890"],
  "invalid": ["not-a-number"],
  "report": "Brief summary of what was found and cleaned"
}

Numbers to validate:
${JSON.stringify(rawNumbers)}`,
        },
      ],
    });

    const text = response.content[0].text;
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  } catch (err) {
    // Fallback: basic regex cleaning
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
      report: `Fallback validation: ${valid.length} valid, ${invalid.length} invalid. Claude parsing failed: ${err.message}`,
    };
  }
}

/**
 * Get the safest bulk-sending strategy from Claude.
 * @param {number} totalCount
 * @returns {Promise<{ delayMs: number, batchSize: number, batchPauseMs: number, advice: string }>}
 */
async function getSendStrategy(totalCount) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `You are a WhatsApp bulk-sending strategist. I need to send messages to ${totalCount} contacts.

Return ONLY raw JSON with no markdown, no code fences, no extra text:
{
  "delayMs": 5000,
  "batchSize": 50,
  "batchPauseMs": 60000,
  "advice": "Safety advice for this send"
}

Consider these safety factors:
- Larger lists need longer delays (3-8 seconds)
- Batch size should not exceed 50
- Include advice about time of day and rate limiting
- Suggest a batchPauseMs (pause between batches)`,
        },
      ],
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON found in response');
  } catch (err) {
    // Sensible defaults
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
      advice: `Sending to ${totalCount} contacts. Default safe strategy applied. Claude parsing failed: ${err.message}`,
    };
  }
}

/**
 * Personalize a message with a contact name using Claude.
 * If no name provided, returns the base message unchanged.
 * @param {string} baseMessage
 * @param {string} [contactName]
 * @returns {Promise<string>}
 */
async function personalizeMessage(baseMessage, contactName) {
  if (!contactName) {
    return baseMessage;
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `Personalize this message by naturally incorporating the contact name "${contactName}" into it. Keep all links, URLs, and formatting intact. Do not change the meaning or remove any information. Return ONLY the personalized message text, no extra text, no quotes.

Original message:
${baseMessage}`,
        },
      ],
    });

    return response.content[0].text.trim();
  } catch (err) {
    // Fallback: simple name insertion
    return baseMessage.replace(/\{name\}/gi, contactName);
  }
}

module.exports = {
  validateNumbers,
  getSendStrategy,
  personalizeMessage,
};
