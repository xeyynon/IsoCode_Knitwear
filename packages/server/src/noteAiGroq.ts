// The same note classifier on Groq (free plan), for a deployment that must cost nothing.
// Same prompt, same schema, same judging (noteAi.ts): only the transport differs. Groq speaks the OpenAI chat-completions format;
// strict JSON-schema output (constrained decoding) means the reason can only be one of the list's ids.
//   AI_PROVIDER=groq  GROQ_API_KEY=...  [AI_MODEL=openai/gpt-oss-120b]
// Free-plan limits (per minute and per day, in requests and tokens): a request over them answers 429, stored as "rate_limited" and
// tried again later like any other failure.
import { AiUnavailable, answerSchema, parseAnswer, systemPrompt, userMessage, AI_TIMEOUT_MS, type NoteClassifier } from './noteAi.js'

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b'
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

interface GroqReply {
  model?: string
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[]
}

export function groqClassifier(opts: { apiKey: string; model?: string; timeoutMs?: number; fetch?: Fetch }): NoteClassifier {
  const model = opts.model ?? DEFAULT_GROQ_MODEL
  const doFetch: Fetch = opts.fetch ?? ((url, init) => fetch(url, init))
  return async (input) => {
    let res: Awaited<ReturnType<Fetch>>
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt(input.reasons) }, { role: 'user', content: userMessage(input) }],
          response_format: { type: 'json_schema', json_schema: { name: 'note_reason', strict: true, schema: answerSchema(input.reasons) } },
          // A short classification: a little reasoning is enough, and keeps each call well inside the free plan's tokens per minute.
          ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
          max_completion_tokens: 2048,
        }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? AI_TIMEOUT_MS),
      })
    } catch (e) {
      throw new AiUnavailable((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError' ? 'timeout' : 'unreachable')
    }
    if (res.status === 429) throw new AiUnavailable('rate_limited')
    if (res.status === 401 || res.status === 403) throw new AiUnavailable('auth')
    // 400 is what Groq answers when the model's output failed the schema: no usable answer, never a guess.
    if (res.status === 400) throw new AiUnavailable('bad_answer')
    if (!res.ok) throw new AiUnavailable('error')
    let body: GroqReply
    try { body = (await res.json()) as GroqReply } catch { throw new AiUnavailable('bad_answer') }
    const c = body.choices?.[0]
    if (!c) throw new AiUnavailable('bad_answer')
    if (c.message?.refusal || c.finish_reason === 'content_filter') throw new AiUnavailable('refused')
    if (c.finish_reason === 'length') throw new AiUnavailable('bad_answer')
    return parseAnswer(c.message?.content ?? '', body.model ?? model)
  }
}
