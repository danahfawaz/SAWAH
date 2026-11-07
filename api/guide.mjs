// SAWAH AI guide (Vercel Function). The browser sends the chat; this function asks Gemini to reply as
// Noura and Mohammed, the Saudi tour guides, and to pull the trip details out of the chat. The plan itself is still built by
// src/planner.js in the browser, so the AI never invents places, hours or prices.
// Needs the environment variable GEMINI_API_KEY (Vercel > Settings > Environment Variables).
// Optional: GEMINI_MODEL to choose another model.
import { CATALOG } from './_catalog.mjs';

const MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'].filter(Boolean);
const INTERESTS = ['heritage', 'culture', 'food', 'nature', 'adventure', 'shopping', 'entertainment', 'modern'];
const GROUPS = ['solo', 'family', 'friends'];
const BUDGETS = ['eco', 'mid', 'high', 'custom'];
const MEALS = ['breakfast', 'lunch', 'dinner'];
const MAX_MSGS = 20, MAX_CHARS = 800;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING', description: 'What the guide says to the user.' },
    fields: {
      type: 'OBJECT',
      description: 'Trip details the user has stated or clearly implied so far. Leave out anything unknown.',
      properties: {
        days: { type: 'INTEGER' },
        people: { type: 'INTEGER' },
        groups: { type: 'ARRAY', items: { type: 'STRING', enum: GROUPS } },
        budget: { type: 'STRING', enum: BUDGETS },
        amount: { type: 'INTEGER', description: 'SAR per person per day, only when budget is custom' },
        interests: { type: 'ARRAY', items: { type: 'STRING', enum: INTERESTS } },
        other: { type: 'STRING', description: 'Extra wishes as short keywords, e.g. "قهوة، إطلالة"' },
        start: { type: 'STRING', description: 'Trip start date as YYYY-MM-DD' },
        stay: { type: 'BOOLEAN', description: 'true if they need a hotel, false if they live in Riyadh or have a place' },
        meals: { type: 'ARRAY', items: { type: 'STRING', enum: MEALS } }
      }
    },
    confirmed: { type: 'BOOLEAN', description: 'true only when the user clearly agreed to the summary you gave' }
  },
  required: ['reply', 'fields', 'confirmed']
};

function riyadhToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function systemPrompt(draft, lang) {
  return `You are Noura and Mohammed (نورة ومحمد), the two friendly Saudi tour guides inside the SAWAH app. SAWAH builds personalised trip plans in Riyadh only.

HOW YOU TALK
- You speak together as "we": in Arabic always say "احنا" (never "نحن"), e.g. "احنا نرتب لك"، "قل لنا"، "نقترح عليك".
- Speak natural Saudi dialect (white Saudi dialect, easy for everyone), warm and short: one to three short sentences. Example words: هلا والله، أبشر، تم، وش رايك، على راحتك، يا هلا.
- If the user writes in English, reply in simple, friendly English as "we" (Noura and Mohammed). The app language is "${lang === 'en' ? 'English' : 'Arabic'}".
- Never ask for personal data (name, phone, email, ID).

YOUR JOB
Collect what SAWAH needs to build the plan, then ask the user to confirm. Required details:
1. days: trip length in days (1 to 14).
2. groups: solo, family or friends (can be more than one), and people: how many people (1 to 20; solo = 1).
3. budget per person per day, hotel not included: eco (up to 150 SAR), mid (up to 450 SAR), high (premium experiences and fine dining), or custom with an amount in SAR.
4. interests (one or more): heritage (history, old Riyadh, Diriyah), culture (museums, art, cinema), food (restaurants, cafes, local food), nature (parks, wadis, desert), adventure (active, sports, quad bikes, dunes), shopping (malls, souqs), entertainment (theme parks, fun, cinema), modern (modern Riyadh, views, architecture). Put any extra wish into "other" as short keywords.
Optional, only if the user mentions them: start date (default is tomorrow), stay (needs a hotel or not; default yes), meals (breakfast, lunch, dinner; default all three).

RULES
- Ask about ONE missing required detail at a time, in a natural way. Accept rough answers (for example "مو غالي" means eco or mid; "مع أهلي" means family).
- In "fields", return everything known so far: start from the current details below, add what the user just said, and change anything the user changed. Leave out what is still unknown. Never guess a value the user did not give.
- When all required details are known, give a very short summary and ask if they want you to build the plan (e.g. "أبني لك الخطة؟"). Set "confirmed" to true only when the user clearly says yes to that summary. If they change something, update it and summarise again.
- Do NOT build or describe a schedule yourself. The app builds the plan after confirmation.
- You may mention places by name only from the PLACES list below, and only when the user asks for ideas. Never invent places, prices or opening hours; say the app shows the details.
- If the user asks about something unrelated to their Riyadh trip, answer in one short line and bring the chat back to the trip.

Today in Riyadh: ${riyadhToday()}. Use it for dates like "بكرة" or "الخميس الجاي".
Current details: ${JSON.stringify(draft || {})}

PLACES (Arabic name | English name | category | area | tags):
${CATALOG}`;
}

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
const list = (v, ok) => (Array.isArray(v) ? [...new Set(v.filter(x => ok.includes(x)))] : undefined);
function cleanFields(f) {
  if (!f || typeof f !== 'object') return {};
  const out = {
    days: int(f.days, 1, 14), people: int(f.people, 1, 20), groups: list(f.groups, GROUPS),
    budget: BUDGETS.includes(f.budget) ? f.budget : undefined, amount: int(f.amount, 1, 100000),
    interests: list(f.interests, INTERESTS), meals: list(f.meals, MEALS),
    other: typeof f.other === 'string' ? f.other.slice(0, 120) : undefined,
    start: typeof f.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.start) ? f.start : undefined,
    stay: typeof f.stay === 'boolean' ? f.stay : undefined
  };
  for (const k of Object.keys(out)) if (out[k] === undefined || (Array.isArray(out[k]) && !out[k].length)) delete out[k];
  return out;
}

async function askGemini(model, key, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body)
    });
  } finally { clearTimeout(timer); }
}

// Ask the models in order: a missing model (404) moves to the next one, and a request the model rejects (400)
// is tried again without the strict JSON schema. Returns {out} or {error, status, detail}.
async function generate(key, request) {
  let last = { error: 'no_model' };
  const busyTried = new Set();
  for (const model of MODELS) {
    for (const strict of [true, false]) {
      const body = strict ? request : { ...request, generationConfig: { ...request.generationConfig, responseSchema: undefined } };
      let r;
      try { r = await askGemini(model, key, body); } catch { return { error: 'timeout', model }; }
      let data = await r.json().catch(() => null);
      let detail = data && data.error && data.error.message ? String(data.error.message).slice(0, 300) : undefined;
      if (r.status === 404) { last = { error: 'no_model', model, detail }; break; }
      if (r.status === 429) return { error: 'busy', model, detail };
      // 500/503 = Google's model is busy for a moment: wait a little, try once more, then use the next model
      if ((r.status === 503 || r.status === 500) && !busyTried.has(model)) { busyTried.add(model); await new Promise(s => setTimeout(s, 1200)); r = await askGemini(model, key, body).catch(() => null); if (!r) return { error: 'timeout', model }; data = await r.json().catch(() => null); detail = data && data.error && data.error.message ? String(data.error.message).slice(0, 300) : undefined; }
      if (r.status === 503 || r.status === 500) { last = { error: 'upstream', status: r.status, model, detail }; break; }
      if (r.status === 400 && strict) { last = { error: 'upstream', status: 400, model, detail }; continue; }
      if (!r.ok) return { error: 'upstream', status: r.status, model, detail };
      const c = data && data.candidates && data.candidates[0];
      const text = c && c.content && c.content.parts && c.content.parts.map(p => p.text || '').join('');
      let out; try { out = JSON.parse(String(text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { out = null; }
      if (!out || typeof out.reply !== 'string' || !out.reply.trim()) return { error: 'bad_answer', model, detail: c && c.finishReason };
      return { out, model };
    }
  }
  return last;
}

export default async function handler(req, res) {
  const key = process.env.GEMINI_API_KEY;
  // Open /api/guide in a browser to check the setup (shows only status text, never the key)
  if (req.method === 'GET') {
    if (!key) return res.status(200).json({ ok: false, problem: 'GEMINI_API_KEY is not set in Vercel (or the site was not redeployed after adding it)' });
    const g = await generate(key, {
      contents: [{ role: 'user', parts: [{ text: 'Reply with {"reply":"ok","fields":{},"confirmed":false}' }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 4096 }
    });
    return res.status(200).json(g.out ? { ok: true, model: g.model } : { ok: false, ...g });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!key) return res.status(503).json({ error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const msgs = Array.isArray(body && body.messages) ? body.messages : null;
  if (!msgs || !msgs.length || msgs.length > 60) return res.status(400).json({ error: 'bad_request' });
  const contents = [];
  for (const m of msgs.slice(-MAX_MSGS)) {
    if (!m || typeof m.text !== 'string' || !m.text.trim()) continue;
    const role = m.role === 'assistant' ? 'model' : 'user', text = m.text.slice(0, MAX_CHARS);
    if (!contents.length && role === 'model') continue; // the chat must start with the user
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += '\n' + text; // keep user/model turns alternating
    else contents.push({ role, parts: [{ text }] });
  }
  if (!contents.length || contents[contents.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });
  const lang = body.lang === 'en' ? 'en' : 'ar';

  // maxOutputTokens is generous because newer Gemini models spend part of it on hidden "thinking"
  const g = await generate(key, {
    systemInstruction: { parts: [{ text: systemPrompt(cleanFields(body.draft), lang) }] },
    contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 8192, responseMimeType: 'application/json', responseSchema: SCHEMA }
  });
  if (!g.out) {
    console.error('guide error', JSON.stringify(g));
    const code = g.error === 'busy' ? 429 : g.error === 'timeout' ? 504 : 502;
    return res.status(code).json(g);
  }
  const out = g.out;
  return res.status(200).json({ reply: out.reply.trim().slice(0, 1200), fields: cleanFields(out.fields), confirmed: out.confirmed === true });
}
