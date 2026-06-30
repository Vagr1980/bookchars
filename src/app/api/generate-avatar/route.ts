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

// Together.ai FLUX.1-schnell-Free — бесплатная модель, хорошее качество,
// работает из Vercel serverless (в отличие от HuggingFace inference API)
async function generateImage(prompt: string): Promise<{ base64: string; mimeType: string }> {
  const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY

  if (TOGETHER_API_KEY) {
    // Together.ai — FLUX.1-schnell-Free (бесплатная)
    const res = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOGETHER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'black-forest-labs/FLUX.1-schnell-Free',
        prompt: prompt.slice(0, 1024),
        width: 512,
        height: 768,
        steps: 4,
        n: 1,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (res.ok) {
      const data = await res.json()
      const b64 = data?.data?.[0]?.b64_json
      if (b64) return { base64: b64, mimeType: 'image/jpeg' }
    }
    // fallthrough to Pollinations on error
    console.warn('[generate-avatar] Together.ai failed, falling back to Pollinations')
  }

  // Fallback: Pollinations.ai
  const seed = Math.floor(Math.random() * 999999)
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 500))}?width=512&height=768&nologo=true&model=flux&seed=${seed}`

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 15000))
    const res = await fetch(url, { signal: AbortSignal.timeout(55000) })
    if (res.status === 429) { if (attempt < 2) continue; throw new Error('Pollinations: очередь переполнена') }
    if (!res.ok) throw new Error(`Pollinations error ${res.status}`)
    const buf = await res.arrayBuffer()
    return { base64: Buffer.from(buf).toString('base64'), mimeType: res.headers.get('content-type') || 'image/jpeg' }
  }
  throw new Error('Не удалось сгенерировать изображение')
}

// Вытаскиваем явный возраст из текстовых описаний или угадываем по роли
function inferAge(appearance: string, description: string, role: string): string {
  const src = (appearance + ' ' + description).toLowerCase()

  // Явный возраст числом: "25 лет", "27 years", "26-летний"
  const numAge = src.match(/\b(\d{1,2})[- ]?(?:лет|год|year|летн)/)?.[1]
  if (numAge) return `${numAge}-year-old`

  // Слова возраста
  if (/\b(юный|молодой|young|youth|teenager|подросток|юноша)\b/.test(src)) return 'young adult, in his 20s'
  if (/\b(пожилой|старый|elderly|старик|старуха|old man|old woman)\b/.test(src)) return 'elderly'
  if (/\b(средних лет|middle.aged|зрелый)\b/.test(src)) return 'middle-aged'
  if (/\b(ребёнок|ребенок|child|мальчик|девочка|boy|girl)\b/.test(src)) return 'child'

  // По умолчанию исходя из роли
  if (role === 'protagonist') return 'young adult'
  if (role === 'mentor') return 'middle-aged'
  return 'adult'
}

function buildFinalPrompt(name: string, appearance: string, description: string, role: string, bookStyle: string): string {
  const age = inferAge(appearance, description || '', role)

  // Структура: возраст + внешность + стиль — модель должна чётко следовать возрасту
  return [
    `Portrait of ${name}, ${age},`,
    appearance,
    `${bookStyle}.`,
    'Highly detailed face, expressive eyes, upper body, soft lighting, neutral background,',
    'professional book character illustration, high quality.',
  ].join(' ')
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

    // ── 5. Строим промпт: явно указываем возраст чтобы модель не угадывала ───
    const fullPrompt = buildFinalPrompt(character.name, avatarPrompt, character.description, character.role, bookStyle)
    const image = await generateImage(fullPrompt)

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
