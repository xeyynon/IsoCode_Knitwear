// Which classifier for notes, from the environment. AI is off (null) unless a key is set; never a fake answer.
//   AI_PROVIDER   anthropic | gemini | groq. Unset: the first of ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY that is set
//   ANTHROPIC_API_KEY / GEMINI_API_KEY / GROQ_API_KEY   the provider's key (in the host's secret settings, never in the repository)
//   AI_MODEL      optional; the provider's model (defaults: claude-opus-5-5, gemini-3.8-flash, openai/gpt-oss-120b)
import { anthropicClassifier, type NoteClassifier } from './noteAi.js'
import { geminiClassifier } from './noteAiGemini.js'
import { groqClassifier } from './noteAiGroq.js'

export class AiConfigError extends Error {}

export function classifierFromEnv(env: Record<string, string | undefined>): NoteClassifier | null {
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim()
  const geminiKey = env.GEMINI_API_KEY?.trim()
  const groqKey = env.GROQ_API_KEY?.trim()
  const model = env.AI_MODEL?.trim() || undefined
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || (anthropicKey ? 'anthropic' : geminiKey ? 'gemini' : groqKey ? 'groq' : '')
  if (!provider) return null
  if (provider === 'anthropic') {
    if (!anthropicKey) throw new AiConfigError('AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY')
    return anthropicClassifier({ apiKey: anthropicKey, model })
  }
  if (provider === 'gemini') {
    if (!geminiKey) throw new AiConfigError('AI_PROVIDER=gemini needs GEMINI_API_KEY')
    return geminiClassifier({ apiKey: geminiKey, model })
  }
  if (provider === 'groq') {
    if (!groqKey) throw new AiConfigError('AI_PROVIDER=groq needs GROQ_API_KEY')
    return groqClassifier({ apiKey: groqKey, model })
  }
  throw new AiConfigError('AI_PROVIDER must be anthropic, gemini or groq')
}
