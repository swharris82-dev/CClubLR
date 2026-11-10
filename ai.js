// One place for every AI call the app makes.
//
// Two services are supported and either one is enough for written diagnosis,
// data plate reading, and equipment briefs:
//   GEMINI_API_KEY     Google Gemini. Also required for live video diagnosis.
//   ANTHROPIC_API_KEY  Anthropic Claude.
// If both are set, AI_PROVIDER picks which goes first ("gemini" or
// "anthropic", default gemini) and the other is the backup when the first
// one fails. Every failure is turned into a sentence a tech can act on.

const GEMINI_KEY = () => (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const ANTHROPIC_KEY = () => (process.env.ANTHROPIC_API_KEY || '').trim();

const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const GEMINI_LIVE_MODEL = () => (process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live').replace(/^models\//, '');
// Tried in order. A retired model name moves on to the next one instead of
// taking diagnosis down.
const ANTHROPIC_MODELS = () => (process.env.ANTHROPIC_MODEL
  ? [process.env.ANTHROPIC_MODEL] : []).concat(['claude-sonnet-5-5', 'claude-sonnet-4-6']);

const GEMINI_BASE = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
const ANTHROPIC_BASE = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

function providers() {
  const have = [];
  if (GEMINI_KEY()) have.push('gemini');
  if (ANTHROPIC_KEY()) have.push('anthropic');
  const first = (process.env.AI_PROVIDER || '').toLowerCase();
  if (first && have.includes(first)) return [first].concat(have.filter(p => p !== first));
  return have;
}
const ready = () => providers().length > 0;
const liveReady = () => !!GEMINI_KEY();

const NAME = { gemini: 'Google Gemini', anthropic: 'Anthropic Claude' };
const KEYVAR = { gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

class AiError extends Error {
  constructor(message, kind, provider) { super(message); this.kind = kind; this.provider = provider; }
}

// Turn an HTTP failure from either service into something plain.
function explain(provider, status, bodyText) {
  let detail = '';
  try {
    const j = JSON.parse(bodyText);
    detail = (j.error && (j.error.message || j.error.type)) || '';
  } catch (e) { detail = String(bodyText || '').slice(0, 160); }
  const low = detail.toLowerCase();
  const who = NAME[provider], kv = KEYVAR[provider];
  if (status === 401 || status === 403 || low.includes('api key not valid') || low.includes('invalid x-api-key') || low.includes('authentication'))
    return new AiError(`The ${who} key on the server was rejected. Check ${kv} in the hosting settings.`, 'key', provider);
  if (low.includes('credit balance') || low.includes('billing') || status === 402)
    return new AiError(`The ${who} account is out of credit or has no billing set up. Add credit, then try again.`, 'billing', provider);
  if (status === 429 || low.includes('quota') || low.includes('rate limit'))
    return new AiError(`${who} is turning requests away right now (rate or quota limit). Wait a minute and try again.`, 'quota', provider);
  if (status === 404 || low.includes('not_found') || low.includes('is not found') || low.includes('not supported'))
    return new AiError(`${who} does not recognize the model name the app asked for.`, 'model', provider);
  if (status === 529 || status === 503 || low.includes('overloaded') || low.includes('unavailable'))
    return new AiError(`${who} is busy right now. Try again in a moment.`, 'busy', provider);
  return new AiError(`${who} returned an error (${status}). ${detail}`.trim(), 'other', provider);
}

async function post(url, headers, body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 60000);
  try {
    return await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: ctl.signal });
  } finally { clearTimeout(t); }
}

async function callGemini({ prompt, image, mediaType, maxTokens, json }) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: mediaType || 'image/jpeg', data: image } });
  parts.push({ text: prompt });
  const generationConfig = { maxOutputTokens: maxTokens || 2000 };
  if (json) generationConfig.responseMimeType = 'application/json';
  let r;
  try {
    r = await post(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(GEMINI_MODEL())}:generateContent`,
      { 'x-goog-api-key': GEMINI_KEY() }, { contents: [{ role: 'user', parts }], generationConfig });
  } catch (e) { throw new AiError('Could not reach Google Gemini from the server. ' + (e.name === 'AbortError' ? 'It took too long to answer.' : e.message), 'network', 'gemini'); }
  const text = await r.text();
  if (!r.ok) throw explain('gemini', r.status, text);
  let data; try { data = JSON.parse(text); } catch (e) { throw new AiError('Google Gemini sent back something unreadable.', 'other', 'gemini'); }
  const cand = (data.candidates || [])[0] || {};
  const out = ((cand.content || {}).parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('\n').trim();
  if (!out) {
    const why = cand.finishReason || (data.promptFeedback || {}).blockReason || 'no text';
    throw new AiError(`Google Gemini returned an empty answer (${why}).`, 'empty', 'gemini');
  }
  return out;
}

async function callAnthropic({ prompt, image, mediaType, maxTokens }) {
  const content = image
    ? [{ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } }, { type: 'text', text: prompt }]
    : prompt;
  let lastErr;
  for (const model of ANTHROPIC_MODELS()) {
    let r;
    try {
      r = await post(`${ANTHROPIC_BASE}/v1/messages`,
        { 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
        { model, max_tokens: maxTokens || 2000, messages: [{ role: 'user', content }] });
    } catch (e) { throw new AiError('Could not reach Anthropic from the server. ' + (e.name === 'AbortError' ? 'It took too long to answer.' : e.message), 'network', 'anthropic'); }
    const text = await r.text();
    if (!r.ok) {
      lastErr = explain('anthropic', r.status, text);
      if (lastErr.kind === 'model') continue; // try the next model name
      throw lastErr;
    }
    let data; try { data = JSON.parse(text); } catch (e) { throw new AiError('Anthropic sent back something unreadable.', 'other', 'anthropic'); }
    const out = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    if (!out) throw new AiError('Anthropic returned an empty answer.', 'empty', 'anthropic');
    return out;
  }
  throw lastErr || new AiError('Anthropic did not accept any model name.', 'model', 'anthropic');
}

// Ask whichever service is set up. Falls through to the backup on failure.
async function ask(opts) {
  const list = providers();
  if (!list.length) throw new AiError('AI is not set up on the server yet. A manager needs to add GEMINI_API_KEY (or ANTHROPIC_API_KEY) in the hosting settings.', 'nokey');
  let first;
  for (const p of list) {
    try { return await (p === 'gemini' ? callGemini(opts) : callAnthropic(opts)); }
    catch (e) { if (!first) first = e; console.log(`  AI (${p}) failed: ${e.message}`); }
  }
  throw first;
}

// Pull a JSON object out of a model answer even when it arrives wrapped in a
// code fence, with a sentence in front of it, or cut off a little early.
function parseJson(text) {
  let s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{');
  if (a < 0) return null;
  s = s.slice(a);
  const b = s.lastIndexOf('}');
  if (b > 0) { try { return JSON.parse(s.slice(0, b + 1)); } catch (e) {} }
  // Cut off mid-answer: close whatever is still open and try once more.
  let inStr = false, escNext = false; const stack = [];
  for (const ch of s) {
    if (escNext) { escNext = false; continue; }
    if (ch === '\\') { escNext = inStr; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}' || ch === ']') stack.pop();
  }
  let fixed = s + (inStr ? '"' : '');
  fixed = fixed.replace(/,\s*$/, '').replace(/"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '');
  while (stack.length) fixed += stack.pop() === '{' ? '}' : ']';
  try { return JSON.parse(fixed); } catch (e) { return null; }
}

// Ask for JSON. One retry if the first answer does not parse.
async function askJson(opts) {
  for (let i = 0; i < 2; i++) {
    const text = await ask(Object.assign({ json: true }, opts));
    const parsed = parseJson(text);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  throw new AiError('The AI answered, but not in a form the app could read. Try again.', 'parse');
}

// A real call to each configured service, so a manager can see exactly what
// is wrong instead of a generic failure.
async function status() {
  const out = { ready: ready(), live: liveReady(), order: providers(), services: [] };
  for (const p of ['gemini', 'anthropic']) {
    const has = p === 'gemini' ? !!GEMINI_KEY() : !!ANTHROPIC_KEY();
    const row = { id: p, name: NAME[p], key_var: KEYVAR[p], configured: has, ok: false, message: '' };
    if (!has) row.message = `${KEYVAR[p]} is not set.`;
    else {
      try {
        await (p === 'gemini' ? callGemini : callAnthropic)({ prompt: 'Reply with the single word OK.', maxTokens: 200 });
        row.ok = true; row.message = 'Working.';
      } catch (e) { row.message = e.message; }
    }
    out.services.push(row);
  }
  return out;
}

// Short-lived, single-use pass that lets one phone open one live video
// session straight to Gemini. The real key never leaves the server. The
// session's instructions are built here, from the equipment record.
async function liveToken({ systemText, voice, spanish }) {
  if (!GEMINI_KEY()) throw new AiError('Live video needs a Google Gemini key. A manager needs to add GEMINI_API_KEY in the hosting settings.', 'nokey', 'gemini');
  const model = 'models/' + GEMINI_LIVE_MODEL();
  const now = Date.now();
  const setup = {
    model,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || process.env.GEMINI_VOICE || 'Kore' } } }
    },
    systemInstruction: { parts: [{ text: systemText }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: {},
    contextWindowCompression: { slidingWindow: {} }
  };
  if (spanish) setup.generationConfig.speechConfig.languageCode = 'es-US';
  let r;
  try {
    r = await post(`${GEMINI_BASE}/v1beta/auth_tokens`, { 'x-goog-api-key': GEMINI_KEY() }, {
      uses: 1,
      expireTime: new Date(now + 30 * 60000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60000).toISOString()
    }, 20000);
  } catch (e) { throw new AiError('Could not reach Google Gemini from the server. ' + e.message, 'network', 'gemini'); }
  const text = await r.text();
  if (!r.ok) throw explain('gemini', r.status, text);
  let data; try { data = JSON.parse(text); } catch (e) { data = {}; }
  if (!data.name) throw new AiError('Google Gemini did not return a session pass.', 'other', 'gemini');
  const wsBase = GEMINI_BASE.replace(/^http/, 'ws');
  return {
    token: data.name,
    url: `${wsBase}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained`,
    setup,
    minutes: 30
  };
}

module.exports = { ask, askJson, parseJson, status, liveToken, ready, liveReady, providers, AiError, GEMINI_LIVE_MODEL };
