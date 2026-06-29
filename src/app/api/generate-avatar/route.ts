import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { uploadAvatarToStorage } from '@/lib/gemini'

function getAdminClient() {
  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const maxDuration = 120

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

// Hugging Face FLUX.1-schnell — бесплатно, 1000 картинок/день, без очередей по IP
async function generateWithHuggingFace(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const HF_TOKEN = process.env.HF_TOKEN
  if (!HF_TOKEN) throw new Error('HF_TOKEN не задан')

  const safePrompt = prompt.slice(0, 500)

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 20000)) // 20s, 40s — модель может грузиться

    const res = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true',
      },
      body: JSON.stringify({
        inputs: safePrompt,
        parameters: { width: 512, height: 768 },
      }),
      signal: AbortSignal.timeout(60000),
    })

    // 503 = модель ещё грузится — ждём и повторяем
    if (res.status === 503) {
      if (attempt < 2) continue
      throw new Error('HuggingFace: модель не ответила вовремя')
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`HuggingFace error ${res.status}: ${err.slice(0, 200)}`)
    }

    const buf = await res.arrayBuffer()
    const mimeType = res.headers.get('content-type') || 'image/jpeg'
    return { base64: Buffer.from(buf).toString('base64'), mimeType }
  }
  throw new Error('HuggingFace: превышено число попыток')
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

    // ── 4. Строим промпт напрямую из appearance (без Groq — экономим TPM) ─────
    // Groq для промптов аватаров убран: при 13 персонажах он исчерпывает 6k TPM.
    // appearance уже содержит детальное описание на английском из этапа анализа.
    const avatarPrompt = character.avatar_prompt || character.appearance

    // ── 5. Генерируем изображение через Hugging Face FLUX.1-schnell ──────────
    const fullPrompt = `Portrait of ${character.name}. ${avatarPrompt}. ${bookStyle}. Soft lighting, detailed face, neutral background, high quality portrait.`
    const image = await generateWithHuggingFace(fullPrompt)

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
