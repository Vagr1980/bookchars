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

// Определяем культурный стиль по названию/автору книги
function detectBookStyle(title: string, author: string): string {
  const t = (title + ' ' + author).toLowerCase()

  if (/ершов|конёк|горбун|пушкин|жуковский|народн|сказк|руслан|людмил|колобок|репк|теремок|снегур/.test(t))
    return 'Russian folk tale illustration style, Slavic folk art, traditional Russian costume, Ivan Bilibin style'

  if (/толстой|dostoevsk|достоевск|чехов|тургенев|гоголь|булгаков|19 век|xix/.test(t))
    return 'Russian 19th century realist illustration, period-accurate Russian Imperial era clothing'

  if (/harry potter|гарри поттер|rowling/.test(t))
    return 'British fantasy illustration, Hogwarts wizard robes, British fantasy art style'

  if (/tolkien|толкин|властелин|lord of the rings|hobbit/.test(t))
    return 'High fantasy illustration, Tolkien-inspired, Alan Lee style'

  if (/japan|аниме|наруто|самур|манга/.test(t))
    return 'Japanese illustration style, anime-inspired character art'

  if (/middle.?earth|medieval|рыцар|knight|меч и маг/.test(t))
    return 'Medieval fantasy illustration, European medieval clothing and armor'

  // По умолчанию — нейтральный книжный стиль
  return 'painterly book illustration style, professional character art'
}

// Pollinations.ai — бесплатно, без ключа
async function generateWithPollinations(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const safePrompt = prompt.slice(0, 450)
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

    // ── 1. Получаем персонажа вместе с книгой ────────────────────────────────
    const { data: character, error } = await supabase
      .from('characters')
      .select('*, books(title, author)')
      .eq('id', character_id)
      .single()

    if (error || !character) {
      return NextResponse.json({ error: 'Персонаж не найден' }, { status: 404 })
    }

    // ── 2. Если аватар уже есть — возвращаем его ──────────────────────────────
    if (character.avatar_url) {
      return NextResponse.json({ character_id, avatar_url: character.avatar_url })
    }

    // ── 3. Определяем культурный стиль книги ─────────────────────────────────
    const bookTitle  = (character.books as any)?.title  || ''
    const bookAuthor = (character.books as any)?.author || ''
    const bookStyle  = detectBookStyle(bookTitle, bookAuthor)

    // ── 4. Генерируем промпт через Groq (с контекстом книги) ─────────────────
    let avatarPrompt = character.avatar_prompt
    if (!avatarPrompt) {
      avatarPrompt = await generateAvatarPrompt(character.name, character.appearance, bookTitle, bookAuthor)
      await supabase
        .from('characters')
        .update({ avatar_prompt: avatarPrompt })
        .eq('id', character_id)
    }

    // ── 5. Генерируем изображение через Pollinations.ai ──────────────────────
    const fullPrompt = `${avatarPrompt}. ${bookStyle}. Soft cinematic lighting, detailed face, neutral background, high quality.`
    const image = await generateWithPollinations(fullPrompt)

    // ── 6. Загружаем в Supabase Storage ──────────────────────────────────────
    const avatarUrl = await uploadAvatarToStorage(image.base64, image.mimeType, character_id)

    // ── 7. Обновляем запись персонажа ─────────────────────────────────────────
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
