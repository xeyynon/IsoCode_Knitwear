// The same note classifier on Google's Gemini API (free tier in AI Studio), for a deployment that must cost nothing.
// Same prompt, same schema, same judging (noteAi.ts): only the transport differs. Called over plain HTTPS (generateContent,
// which Google keeps fully supported), so no extra dependency.
//   AI_PROVIDER=gemini  GEMINI_API_KEY=...  [AI_MODEL=gemini-3.8-flash]
// Free-tier limits are per minute and per day: a request over them answers 429, which is stored as "rate_limited" and tried
// again later, exactly like any other failure. Free-tier prompts may be used by Google to improve its products: demo data only.
import { AiUnavailable, answerSchema, parseAnswer, systemPrompt, userMessage, AI_TIMEOUT_MS, type NoteClassifier } from './noteAi.js'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

interface GeminiReply {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  promptFeedback?: { blockReason?: string }
  modelVersion?: string
}

/** The answer schema in the OpenAPI subset generateContent takes (upper-case types; enum on a string). */
export function geminiSchema(reasons: Parameters<typeof answerSchema>[0]) {
  const s = answerSchema(reasons)
  return {
    type: 'OBJECT',
    properties: {
      english: { type: 'STRING', description: s.properties.english.description },
      category: { type: 'STRING', enum: [...s.properties.category.enum], description: s.properties.category.description },
      confidence: { type: 'NUMBER', description: s.properties.confidence.description },
      why: { type: 'STRING', description: s.properties.why.description },
    },
    required: [...s.required],
    propertyOrdering: ['english', 'category', 'confidence', 'why'],
  }
}

export function geminiClassifier(opts: { apiKey: string; model?: string; timeoutMs?: number; fetch?: Fetch }): NoteClassifier {
  const model = opts.model ?? DEFAULT_GEMINI_MODEL
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init))
  return async (input) => {
    let res: Awaited<ReturnType<Fetch>>
    try {
      res = await doFetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // The key goes in a header, never in the address, so it cannot end up in a proxy or access log.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(input.reasons) }] },
          contents: [{ role: 'user', parts: [{ text: userMessage(input) }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(input.reasons), maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? AI_TIMEOUT_MS),
      })
    } catch (e) {
      throw new AiUnavailable((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError' ? 'timeout' : 'unreachable')
    }
    if (res.status === 429) throw new AiUnavailable('rate_limited')
    if (res.status === 401 || res.status === 403) throw new AiUnavailable('auth')
    if (!res.ok) throw new AiUnavailable('error')
    let body: GeminiReply
    try { body = (await res.json()) as GeminiReply } catch { throw new AiUnavailable('bad_answer') }
    if (body.promptFeedback?.blockReason) throw new AiUnavailable('refused')
    const c = body.candidates?.[0]
    if (!c) throw new AiUnavailable('bad_answer')
    if (c.finishReason && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(c.finishReason)) throw new AiUnavailable('refused')
    if (c.finishReason === 'MAX_TOKENS') throw new AiUnavailable('bad_answer')
    // Thinking models may send their reasoning as parts marked `thought`: only the answer counts.
    const text = (c.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('')
    return parseAnswer(text, body.modelVersion ?? model)
  }
}
