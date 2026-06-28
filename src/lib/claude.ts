// lib/claude.ts — заменён на Google Gemini (бесплатный уровень)
// gemini-2.0-flash: 15 req/min, 1M токенов/день, 1500 req/день — бесплатно

const GEMINI_KEY = process.env.GEMINI_API_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`

async function geminiText(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface ExtractedCharacter {
  id: string
  name: string
  role: 'protagonist' | 'antagonist' | 'supporting' | 'mentor' | 'other'
  role_label: string
  appearance: string
  description: string
}

export interface ExtractedRelationship {
  from: string
  to: string
  type: string
  description?: string
}

export interface ExtractionResult {
  characters: ExtractedCharacter[]
  relationships: ExtractedRelationship[]
  title?: string
  author?: string
}

// ─── Генерация промпта для аватара ───────────────────────────────────────────

export async function generateAvatarPrompt(
  characterName: string,
  appearance: string
): Promise<string> {
  const text = await geminiText(
    `Create a detailed image generation prompt for a unique character portrait.
Character name: ${characterName}
Appearance description: ${appearance}

Requirements:
- This character must look VISUALLY DISTINCT — unique face, hair, eyes
- Emphasize the specific distinguishing features from the appearance description
- Painterly portrait style, soft cinematic lighting
- Neutral or blurred background, focus on face and upper body
- Professional book illustration quality
- Include specific hair color, eye color, and at least one unique facial feature

Return ONLY the prompt text, no explanations.`
  )
  return text.trim() || appearance
}
