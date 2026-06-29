import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { generateAvatarPrompt } from '@/lib/claude'
import { uploadAvatarToStorage } from '@/lib/gemini'

function getAdminClient() {
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const maxDuration = 30

// Pollinations.ai — бесплатно, без ключа, ~512×768 portrait
async function generateWithPollinations(prompt: string): Promise<{ base64: string; mimeType: string }> {
  // Limit prompt length to avoid URL issues
  const safePrompt = prompt.slice(0, 400)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(safePrompt)}?width=512&height=768&nologo=true&model=flux&seed=${Math.floor(Math.random() * 999999)}`

  const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
  if (!res.ok) throw new Error(`Pollinations error ${res.status}: ${await res.text()}`)

  const buf = await res.arrayBuffer()
  return {
    base64: Buffer.from(buf).toString('base64'),
    mimeType: res.headers.get('content-type') || 'image/jpeg',
  }
}

export async function POST(req: NextRequest) {
  try {
    const { character_id } = await req.json()

    if (!character_id) {
      return NextResponse.json({ error: 'character_id обязателен' }, { status: 400 })
    }

    const supabase = getAdminClient()

    // ── 1. Получаем персонажа ─────────────────────────────────────────────────
    const { data: character, error } = await supabase
      .from('characters')
      .select('*')
      .eq('id', character_id)
      .single()

    if (error || !character) {
      return NextResponse.json({ error: 'Персонаж не найден' }, { status: 404 })
    }

    // ── 2. Если аватар уже есть — возвращаем его ──────────────────────────────
    if (character.avatar_url) {
      return NextResponse.json({ character_id, avatar_url: character.avatar_url })
    }

    // ── 3. Генерируем промпт через Groq ───────────────────────────────────────
    let avatarPrompt = character.avatar_prompt
    if (!avatarPrompt) {
      avatarPrompt = await generateAvatarPrompt(character.name, character.appearance)
      await supabase
        .from('characters')
        .update({ avatar_prompt: avatarPrompt })
        .eq('id', character_id)
    }

    // ── 4. Генерируем изображение через Pollinations.ai ───────────────────────
    const image = await generateWithPollinations(
      `Portrait of ${character.name}. ${avatarPrompt}. Painterly illustration, soft lighting, detailed face, neutral background, professional book character art.`
    )

    // ── 5. Загружаем в Supabase Storage ──────────────────────────────────────
    const avatarUrl = await uploadAvatarToStorage(image.base64, image.mimeType, character_id)

    // ── 6. Обновляем запись персонажа ─────────────────────────────────────────
    await supabase
      .from('characters')
      .update({ avatar_url: avatarUrl, avatar_prompt: avatarPrompt })
      .eq('id', character_id)

    return NextResponse.json({ character_id, avatar_url: avatarUrl })

  } catch (err) {
    console.error('[generate-avatar] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
