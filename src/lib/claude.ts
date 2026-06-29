// lib/claude.ts — Groq (бесплатный tier, llama-3.3-70b)

async function groqText(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2048,
      temperature: 0.1,
    }),
  })
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
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
  const text = await groqText(
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
