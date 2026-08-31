import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { LLM_PROVIDER, modelFor } from '../config/constants.js';
import { resolveMimeType } from '../utils/fileType.js';

/**
 * One place every model call goes through, so the system is not tied to a
 * single vendor.
 *
 * This exists because billing on one provider stopped the whole pipeline —
 * receipt OCR, travel estimates and the expense auditor all failed together.
 * Switching is now `LLM_PROVIDER=openai|anthropic` with no code change.
 *
 * Both providers receive the same thing: optional system text, user text,
 * optional image/PDF attachments, and an optional JSON schema. Both return
 * parsed JSON.
 */

let anthropicClient;
let openaiClient;

function getAnthropic() {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function getOpenAI() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * The bytes decide the type, not the caller's label.
 *
 * Both providers reject a mislabelled image outright ("specified as image/png
 * but appears to be image/jpeg"), which would fail the whole audit over a
 * cosmetic detail. Resolving here means no caller can get this wrong.
 */
function normaliseMime(buffer, declared) {
  const actual = resolveMimeType(buffer, declared);
  if (actual === 'application/pdf') return 'application/pdf';
  return SUPPORTED_IMAGE_TYPES.includes(actual) ? actual : 'image/jpeg';
}

/** Pulls the first JSON object out of a text response. */
function parseJsonLoose(raw) {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────

async function completeAnthropic({ system, text, files, schema, schemaName, maxTokens, model }) {
  const client = getAnthropic();

  const blocks = files.map((f) => {
    const media_type = normaliseMime(f.buffer, f.mimetype);
    const data = f.buffer.toString('base64');
    return media_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type, data } }
      : { type: 'image', source: { type: 'base64', media_type, data } };
  });

  const request = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }],
  };
  if (system) request.system = system;

  // A strict tool is Anthropic's structured-output mechanism.
  if (schema) {
    request.tools = [{ name: schemaName, description: 'Record the result.', strict: true, input_schema: schema }];
    request.tool_choice = { type: 'tool', name: schemaName };
  }

  let response;
  try {
    response = await client.messages.create(request);
  } catch (err) {
    // Some models reject a forced tool choice; the single tool plus the prompt
    // is enough on its own.
    if (err?.status === 400 && request.tool_choice) {
      const retry = { ...request };
      delete retry.tool_choice;
      response = await client.messages.create(retry);
    } else {
      throw err;
    }
  }

  if (response.stop_reason === 'refusal') {
    return { data: null, refusal: 'Model declined this request', usage: response.usage, model };
  }

  const toolUse = response.content?.find((b) => b.type === 'tool_use');
  const data = toolUse?.input
    ?? parseJsonLoose(response.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n'));

  return {
    data,
    refusal: null,
    usage: response.usage
      ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
      : null,
    model,
  };
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function completeOpenAI({ system, text, files, schema, schemaName, maxTokens, model }) {
  const client = getOpenAI();

  // The Responses API is used rather than chat.completions because it accepts
  // PDFs directly. Around 4% of receipts are PDFs (52 in the last 90 days), so
  // dropping them was not an option.
  const content = files.map((f) => {
    const mime = normaliseMime(f.buffer, f.mimetype);
    const dataUrl = `data:${mime};base64,${f.buffer.toString('base64')}`;
    return mime === 'application/pdf'
      ? { type: 'input_file', filename: 'attachment.pdf', file_data: dataUrl }
      : { type: 'input_image', image_url: dataUrl };
  });
  content.push({ type: 'input_text', text });

  const request = {
    model,
    max_output_tokens: maxTokens,
    input: [{ role: 'user', content }],
  };
  if (system) request.instructions = system;
  if (schema) {
    request.text = {
      format: { type: 'json_schema', name: schemaName, strict: true, schema },
    };
  }

  const response = await client.responses.create(request);

  // A refusal arrives as a content part, not an error.
  const refusal = response.output
    ?.flatMap((item) => item.content || [])
    ?.find((part) => part.type === 'refusal')?.refusal;
  if (refusal) {
    return { data: null, refusal, usage: response.usage, model };
  }

  const data = parseJsonLoose(response.output_text);

  return {
    data,
    refusal: null,
    usage: response.usage
      ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
      : null,
    model,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sends a prompt (with optional receipt images/PDFs) and returns parsed JSON.
 *
 * @param {object}  opts
 * @param {string} [opts.system]      instructions that are not user data
 * @param {string}  opts.text         the user-facing prompt
 * @param {Array}  [opts.files]       [{ buffer, mimetype }] images or PDFs
 * @param {object} [opts.schema]      JSON schema; enables strict structured output
 * @param {string} [opts.schemaName]  name for that schema
 * @param {number} [opts.maxTokens]
 * @param {string} [opts.purpose]     'ocr' | 'audit' — selects the default model
 * @param {string} [opts.model]       explicit override
 * @returns {Promise<{data, refusal, usage, model}>}
 */
export async function completeJSON({
  system,
  text,
  files = [],
  schema = null,
  schemaName = 'result',
  maxTokens = 1024,
  purpose = 'ocr',
  model,
  provider = LLM_PROVIDER,
}) {
  const resolvedModel = model || modelFor(purpose, provider);
  const args = { system, text, files, schema, schemaName, maxTokens, model: resolvedModel };

  return provider === 'openai' ? completeOpenAI(args) : completeAnthropic(args);
}

/** Which provider is live — for logging and for the /health line. */
export function activeProvider() {
  return LLM_PROVIDER;
}
