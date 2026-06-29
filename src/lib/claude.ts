// lib/claude.ts — Groq (llama-3.1-8b-instant: 500k TPD / 131k TPM)

async function groqText(prompt: string): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1024,
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
  appearance: string,
  bookTitle?: string,
  bookAuthor?: string,
): Promise<string> {
  const bookContext = bookTitle ? `\nBook: "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}` : ''

  const text = await groqText(
    `Create a concise image generation prompt for a character portrait.
Character: ${characterName}${bookContext}
Appearance: ${appearance}

Requirements:
- Appearance MUST match the book's cultural/historical setting (Russian folk tale = Slavic features and costume, NOT Greek/Roman/Western European)
- Visually DISTINCT: specific hair color, eye color, unique face features
- Focus on face and upper body, neutral background
- Do NOT add elements from other cultures if the book has a specific setting

Return ONLY the prompt text (2-3 sentences max), no explanations.`
  )
  return text.trim() || appearance
}
