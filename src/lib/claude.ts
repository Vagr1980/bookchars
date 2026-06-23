import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// ─── Типы ответа от Claude ───────────────────────────────────────────────────

export interface ExtractedCharacter {
  id: string
  name: string
  role: 'protagonist' | 'antagonist' | 'supporting' | 'mentor' | 'other'
  role_label: string
  appearance: string   // EN, для генерации аватара
  description: string  // RU, для отображения
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

// ─── Промпт для извлечения персонажей ───────────────────────────────────────

const SYSTEM_PROMPT = `Ты — литературный аналитик. Твоя задача: извлечь всех персонажей из текста книги и связи между ними.

ВАЖНЫЕ ПРАВИЛА:
1. Возвращай ТОЛЬКО валидный JSON без Markdown-блоков, преамбулы и пояснений
2. Поле appearance — на АНГЛИЙСКОМ языке (для AI-генерации изображения)
3. Поле description — на РУССКОМ языке
4. id персонажа — латиница, snake_case, без пробелов
5. Связи должны быть двусторонними там, где это уместно
6. Если авторство/название не упоминается в тексте, оставь поля null`

const USER_PROMPT = (text: string) => `Проанализируй текст и верни JSON строго следующего формата:

{
  "title": "Название книги или null",
  "author": "Автор или null",
  "characters": [
    {
      "id": "harry_potter",
      "name": "Гарри Поттер",
      "role": "protagonist",
      "role_label": "Главный герой",
      "appearance": "Young boy with messy dark hair, bright green eyes, round glasses, and a lightning bolt scar on his forehead. Slender build, wearing school robes.",
      "description": "Мальчик, выживший после атаки Волан-де-Морта. Смелый, верный друг, обладает исключительными способностями к квиддичу."
    }
  ],
  "relationships": [
    {
      "from": "harry_potter",
      "to": "hermione_granger",
      "type": "лучший друг",
      "description": "Неразлучные друзья с первого курса"
    }
  ]
}

Роли (role): protagonist, antagonist, supporting, mentor, other

Текст книги:
${text.substring(0, 8000)}`

// ─── Основная функция извлечения ─────────────────────────────────────────────

export async function extractCharacters(text: string): Promise<ExtractionResult> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: USER_PROMPT(text) }
    ],
  })

  const raw = message.content[0].type === 'text' ? message.content[0].text : ''
  const cleaned = raw.replace(/```json|```/g, '').trim()

  try {
    const parsed = JSON.parse(cleaned) as ExtractionResult
    return parsed
  } catch {
    throw new Error(`Не удалось распарсить ответ Claude: ${raw.substring(0, 200)}`)
  }
}

// ─── Генерация промпта для аватара ───────────────────────────────────────────

export async function generateAvatarPrompt(
  characterName: string,
  appearance: string
): Promise<string> {
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Create a detailed image generation prompt for a character portrait.
Character: ${characterName}
Appearance: ${appearance}

Requirements:
- Painterly fantasy portrait style
- Soft cinematic lighting
- Neutral or blurred background
- Focus on face and upper body
- Highly detailed facial features
- Professional book illustration quality

Return ONLY the prompt text, nothing else.`
    }]
  })

  return message.content[0].type === 'text' ? message.content[0].text.trim() : appearance
}
