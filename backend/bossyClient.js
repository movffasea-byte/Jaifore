/* ================================
   JAIFORE — BOSSY BOT MODEL CLIENT
   backend/bossyClient.js

   Everything model-specific lives here so the model can be swapped
   with the BOSSY_MODEL env var alone.

   Haiku 5.5 notes: do NOT send sampling params (temperature, top_p...)
   and do NOT use assistant prefill — both error on this model.
   ================================ */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.BOSSY_MODEL || 'claude-haiku-5-5';
const MAX_TOKENS = 500;

let client;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Send one request to the model. Prompt caching is set on the system prompt
 * and on the last tool definition (which caches the whole tools block).
 * Returns the raw SDK message.
 */
async function createReply({ system, messages, tools = [] }) {
  const params = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  };

  if (tools.length) {
    params.tools = tools.map((tool, i) =>
      i === tools.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool
    );
  }

  return getClient().messages.create(params);
}

/** Join the text blocks of a model response into one string. */
function extractText(message) {
  return (message.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

module.exports = { MODEL, createReply, extractText };
