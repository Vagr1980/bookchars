// Генерация аватаров через Gemini 2.5 Flash Image (бесплатно, 500/день)
// Docs: https://ai.google.dev/api/generate-content

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${GEMINI_API_KEY}`

export interface GeneratedImage {
  base64: string
  mimeType: string
}

export async function generateCharacterAvatar(
  prompt: string,
  characterName: string
): Promise<GeneratedImage> {
  const fullPrompt = `Portrait of ${characterName}. ${prompt}. 
Style: painterly illustration, soft lighting, detailed face, neutral background, 
book character art, high quality, professional.`

  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
      }
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${err}`)
  }

  const data = await response.json()

  // Извлекаем base64 из ответа
  const parts = data?.candidates?.[0]?.content?.parts
  if (!parts) throw new Error('Gemini: пустой ответ')

  for (const part of parts) {
    if (part.inlineData?.data) {
      return {
        base64: part.inlineData.data,
        mimeType: part.inlineData.mimeType || 'image/png'
      }
    }
  }

  throw new Error('Gemini: изображение не найдено в ответе')
}

// ─── Загрузка аватара в Supabase Storage ─────────────────────────────────────

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function uploadAvatarToStorage(
  base64: string,
  mimeType: string,
  characterId: string
): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')
  const ext = mimeType.includes('jpeg') ? 'jpg' : 'png'
  const path = `characters/${characterId}.${ext}`

  const { error } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    })

  if (error) throw new Error(`Storage upload error: ${error.message}`)

  const { data } = supabaseAdmin.storage.from('avatars').getPublicUrl(path)
  return data.publicUrl
}
