// Minimal Groq client (OpenAI-compatible chat completions with tool calling).
import { loadConfig } from './config.js'
loadConfig()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Groq says e.g. "Please try again in 705ms" or "in 7.5s" or "in 1m2.5s".
function retryDelayMs(text) {
  const m = /try again in\s+(?:(\d+)m)?([\d.]+)(ms|s)\b/i.exec(text || '')
  if (!m) return 5000
  const minutes = m[1] ? Number(m[1]) * 60000 : 0
  const value = Number(m[2]) * (m[3].toLowerCase() === 'ms' ? 1 : 1000)
  return minutes + value
}

export async function groqChat({ messages, tools }) {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set (.env locally, service ask-sap-config on BTP).')
  const base = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'

  const body = {
    model,
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0,
    max_tokens: 1200
  }
  // gpt-oss models are reasoning models: keep their thinking short to save tokens.
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low'

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    if (res.ok) return JSON.parse(text)

    // Rate limit: wait for the time Groq asks for, then retry (up to 3 times, max 20 s wait).
    if (res.status === 429 && attempt < 3) {
      const wait = retryDelayMs(text)
      if (wait <= 20000) { await sleep(wait + 300); continue }
    }

    const err = new Error(
      res.status === 429 ? 'Groq rate limit reached (free tier). Wait a minute and try again.'
      : res.status === 401 ? 'Groq rejected the API key (401). Check GROQ_API_KEY.'
      : res.status === 404 ? `Groq model "${model}" is not available to your account. Change GROQ_MODEL.`
      : `Groq error ${res.status}: ${text.slice(0, 300)}`)
    err.status = res.status
    err.body = text
    throw err
  }
}
