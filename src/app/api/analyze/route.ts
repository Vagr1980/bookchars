import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { getCharacterColor, getInitials } from '@/lib/store'

export const maxDuration = 300

function getAdminClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const CHUNK = 8000
const OVERLAP = 800
const MAX_CHUNKS = 5

// llama-3.1-8b-instant: 131k TPM — для быстрого извлечения по кускам
// llama-3.3-70b-versatile: 6k TPM — умный, для финальной консолидации/дедупликации
async function groqCall(prompt: string, model: 'fast' | 'smart'): Promise<string> {
  const modelId = model === 'smart'
    ? 'llama-3.3-70b-versatile'   // умный: лучше понимает смысл, находит дубли
    : 'llama-3.1-8b-instant'      // быстрый: много токенов/мин, для чанков

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: model === 'smart' ? 1000 : 2000,
        temperature: 0.1,
      }),
    })

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}))
      const msg: string = data?.error?.message || ''
      if (msg.includes('per day') || msg.includes('TPD')) {
        const mins = (msg.match(/try again in (\d+)m/) || [])[1]
        throw new Error(`Дневной лимит Groq исчерпан. Попробуйте через ${mins ? mins + ' минут' : 'час'}.`)
      }
      const wait = parseInt(res.headers.get('retry-after') || '65') * 1000
      if (attempt < 2) { await new Promise(r => setTimeout(r, wait)); continue }
      throw new Error(`Groq rate limit: ${msg}`)
    }

    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }
  throw new Error('Groq: превышено число попыток')
}

// Обёртки для обратной совместимости
const groqText = (prompt: string) => groqCall(prompt, 'fast')

function safeParseChunk(raw: string, chunkIndex: number): any | null {
  const clean = raw.replace(/```json|```/g, '').trim()
  const jsonStart = clean.indexOf('{')
  if (jsonStart === -1) return null

  let depth = 0, inString = false, escaped = false, jsonEnd = -1
  for (let i = jsonStart; i < clean.length; i++) {
    const ch = clean[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\' && inString) { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { jsonEnd = i; break } }
  }

  if (jsonEnd !== -1) {
    try { return JSON.parse(clean.slice(jsonStart, jsonEnd + 1)) } catch { /* fall through */ }
  }

  const partial = jsonEnd !== -1 ? clean.slice(jsonStart, jsonEnd + 1) : clean.slice(jsonStart)
  let opens = 0, objs = 0, inStr2 = false, esc2 = false
  for (const ch of partial) {
    if (esc2) { esc2 = false; continue }
    if (ch === '\\' && inStr2) { esc2 = true; continue }
    if (ch === '"') { inStr2 = !inStr2; continue }
    if (inStr2) continue
    if (ch === '[') opens++; else if (ch === ']') opens--
    if (ch === '{') objs++;  else if (ch === '}') objs--
  }
  const trimmed = partial.replace(/,?\s*"[^"]*$/, '').replace(/,?\s*\{[^{}]*$/, '')
  const closing = ']'.repeat(Math.max(0, opens)) + '}'.repeat(Math.max(0, objs))
  try {
    const result = JSON.parse(trimmed + closing)
    console.warn(`[analyze] chunk ${chunkIndex} JSON truncated — recovered ${result?.characters?.length ?? 0} chars`)
    return result
  } catch {
    console.warn(`[analyze] chunk ${chunkIndex} JSON unrecoverable, skipping`)
    return null
  }
}

async function extractChunk(text: string, chunkIndex: number, knownChars: {id: string, name: string, appearance: string}[]) {
  const isFirst = chunkIndex === 0

  // Передаём подсказку по внешности чтобы LLM мог опознать "белокурый" = Мышкин
  const knownSection = knownChars.length > 0
    ? `\nALREADY FOUND characters — if ANY of these appear again (even as a nickname, description, or shortened name), reuse their EXACT id. Do NOT create a new entry:\n${knownChars.map(c => `  id="${c.id}" name="${c.name}"${c.appearance ? ` [looks like: ${c.appearance.slice(0, 100)}]` : ''}`).join('\n')}\n`
    : ''

  const prompt = `Extract characters and relationships from this book fragment.
${knownSection}
━━━ DEDUPLICATION — most critical rule ━━━
Characters often appear WITHOUT their name first, then get named later.
Examples: "the fair-haired young man" → later named "Myshkin" = SAME person
          "червомазый" (nickname) → real name "Rogozhin" = SAME person
          "генеральша" → full name "Епанчина" = SAME person
If a physical description or nickname matches an ALREADY FOUND character → use their existing id, do NOT create a new character.
━━━ HARD EXCLUDE — never extract these ━━━
× Servants, staff, domestics without a significant named role:
  камердинер, лакей, дворецкий, горничная, кучер, слуга, швейцар, footman, butler, maid, coachman, groom, doorman
× Characters who appear only once to perform a single action (open a door, deliver a letter, announce a visitor)
× Nameless passengers, bystanders, crowd members
× "чиновник", "полковник", "генерал" WITHOUT a personal name, unless they are major plot characters
━━━ WHO TO INCLUDE ━━━
✓ Characters with a personal name (first name, surname, or both)
✓ Characters with a title + name ("Prince Myshkin", "General Epanchin")
✓ Named animals and magical creatures in folk tales
✓ Characters who appear in multiple scenes and affect the plot
✓ The title character of the book always
Max ~12 characters total — prefer quality over quantity.
━━━ ROLES — be strict ━━━
protagonist: 1-3 main heroes the story centers on
antagonist: 1-2 main villains/opposing forces
mentor: character who guides/teaches the protagonist
supporting: named secondary characters with multiple appearances
other: ONLY for truly minor named characters (avoid using this role)
━━━ APPEARANCE — required format ━━━
STRICTLY IN ENGLISH. Must include:
• Explicit age: "Age 25", "young man approximately 25 years old", "middle-aged woman around 45", "elderly man in his 70s"
• Hair color, eye color, build
• Era-appropriate clothing (19th century Russian → frock coat / dress, NOT modern)
• One unique visual feature that distinguishes this character
Example: "Age 26, pale thin young man, light brown hair, large mild grey eyes, slight build, simple traveler's cloak, gentle saintly expression"
━━━ OTHER FIELDS ━━━
"name" — character name IN THE ORIGINAL LANGUAGE of the book.
  Russian book → Russian name: "Князь Мышкин", NOT "Prince Myshkin"
  English book → English name: "Harry Potter"
"author" — ONLY the real author's name from the text; null if unsure
"description" — RUSSIAN, 1-2 sentences
Do NOT invent characters not in the text.

Return ONLY valid JSON, no markdown:
{
  ${isFirst ? '"title": "book title or null",\n  "author": "author or null",' : ''}
  "characters": [
    {
      "id": "unique_latin_id_no_spaces",
      "name": "Имя персонажа на языке оригинала",
      "role": "protagonist",
      "role_label": "Главный герой",
      "appearance": "Age XX, [hair color], [eye color], [build], [era clothing], [unique feature]",
      "description": "Краткое описание на русском языке"
    }
  ],
  "relationships": [
    { "from": "id", "to": "id", "type": "тип связи на русском" }
  ]
}
Role values: protagonist, antagonist, supporting, mentor, other
role_label values: Главный герой, Злодей, Второстепенный персонаж, Наставник, Персонаж

Fragment ${chunkIndex + 1}:
${text}`

  const raw = await groqText(prompt)
  return safeParseChunk(raw, chunkIndex)
}

// Финальный шаг: LLM смотрит на ВЕСЬ список и семантически сливает дубли.
// "белокурый молодой человек" + "Князь Мышкин" = один персонаж.
// Один лёгкий запрос (~300 токенов), без текста книги.
async function consolidateCharacters(chars: any[]): Promise<string[]> {
  if (chars.length <= 2) return []

  const list = chars.map(c =>
    `id="${c.id}" | name="${c.name}" | appearance="${(c.appearance || '').slice(0, 120)}" | desc="${(c.description || '').slice(0, 80)}"`
  ).join('\n')

  const prompt = `These characters were extracted from a book in separate passes. Some entries are DUPLICATES — the same person appearing under a description first, then named later.

Examples of duplicates:
- "белокурый молодой человек" (unnamed description) = "Князь Мышкин" (same person, named later)
- "червомазый" (nickname) = "Рогожин" (real name revealed later)
- "генеральша" = "Епанчина" (same woman, different forms of address)

Character list:
${list}

Find all duplicate pairs/groups. For each duplicate group, keep the entry with the most complete REAL NAME (e.g. keep "Князь Лев Николаевич Мышкин", delete "белокурый").

Return ONLY a JSON array of IDs to DELETE (the less complete duplicates). If no duplicates, return [].
Example: ["id1", "id2"]`

  try {
    // Используем умную модель — она лучше понимает смысловые совпадения
    const raw = await groqCall(prompt, 'smart')
    const clean = raw.replace(/```json|```/g, '').trim()
    const start = clean.indexOf('[')
    const end = clean.lastIndexOf(']')
    if (start === -1 || end === -1) return []
    const ids: string[] = JSON.parse(clean.slice(start, end + 1))
    console.log(`[analyze] consolidation (70b) removed ${ids.length} duplicates:`, ids)
    return Array.isArray(ids) ? ids : []
  } catch (e) {
    console.warn('[analyze] consolidation failed:', e)
    return []
  }
}

async function extractCharacters(text: string) {
  const chunks: string[] = []
  let pos = 0
  while (pos < text.length && chunks.length < MAX_CHUNKS) {
    chunks.push(text.slice(pos, pos + CHUNK))
    pos += CHUNK - OVERLAP
  }

  const results: any[] = []
  const knownSoFar: {id: string, name: string, appearance: string}[] = []
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 3000))
    let r: any = null
    try { r = await extractChunk(chunks[i], i, knownSoFar) }
    catch (e) { console.warn(`[analyze] chunk ${i} error:`, e) }
    results.push(r)
    if (r?.characters) {
      for (const c of r.characters) {
        if (c.id && c.name && !knownSoFar.find(k => k.id === c.id)) {
          // Передаём appearance чтобы следующий чанк мог опознать того же персонажа под другим именем
          knownSoFar.push({ id: c.id, name: c.name, appearance: c.appearance || '' })
        }
      }
    }
  }

  const first = results[0] || {}
  const charsByName = new Map<string, any>()
  const idRemaps: Map<string, string>[] = results.map(() => new Map())

  for (let ri = 0; ri < results.length; ri++) {
    const r = results[ri]
    if (!r) continue
    for (const c of (r.characters || [])) {
      const key = c.name?.toLowerCase().trim()
      if (!key) continue
      if (!charsByName.has(key)) {
        let safeId = c.id
        const taken = new Set(Array.from(charsByName.values()).map((x: any) => x.id))
        if (taken.has(safeId)) safeId = safeId + '_' + charsByName.size
        const canonical = { ...c, id: safeId }
        charsByName.set(key, canonical)
        idRemaps[ri].set(c.id, safeId)
      } else {
        idRemaps[ri].set(c.id, charsByName.get(key)!.id)
      }
    }
  }

  let allChars = Array.from(charsByName.values())

  // Пост-обработка: слияние дублей по подстроке имени
  // "Епанчина" ⊂ "генеральша Епанчина" → один персонаж
  // Но "Епанчин" ≠ "Епанчина" (муж и жена) — не сливаем
  const mergeMap = new Map<string, string>() // shortId → canonicalId
  for (const shortChar of allChars) {
    for (const longChar of allChars) {
      if (shortChar.id === longChar.id) continue
      const sn = shortChar.name.toLowerCase().trim()
      const ln = longChar.name.toLowerCase().trim()
      // longChar содержит shortChar как подстроку, оба имеют одинаковое окончание (гендер)
      if (ln.includes(sn) && ln.length > sn.length + 2 && sn.length >= 5) {
        // Убеждаемся что это не разные слова (Епанчин ≠ Епанчина)
        const snEnd = sn.slice(-1)
        const lnSuffix = ln.slice(ln.indexOf(sn) + sn.length)
        if (lnSuffix.length === 0 || lnSuffix.trim() === '') {
          // "Епанчина" ⊂ "генеральша Епанчина" и суффикс пустой → дубль
          // Оставляем более длинное/полное имя
          mergeMap.set(shortChar.id, longChar.id)
        }
      }
    }
  }

  if (mergeMap.size > 0) {
    for (const remap of idRemaps) {
      for (const [oldId, newId] of Array.from(remap.entries())) {
        const canonical = mergeMap.get(newId)
        if (canonical) remap.set(oldId, canonical)
      }
    }
    allChars = allChars.filter(c => !mergeMap.has(c.id))
  }

  // Финальная семантическая консолидация — LLM сливает смысловые дубли
  // ("белокурый" = Мышкин, "червомазый" = Рогожин и т.п.)
  await new Promise(r => setTimeout(r, 3000)) // пауза перед доп. запросом к Groq
  const dupIdsToRemove = await consolidateCharacters(allChars)
  if (dupIdsToRemove.length > 0) {
    const dupSet = new Set(dupIdsToRemove)
    allChars = allChars.filter(c => !dupSet.has(c.id))
  }

  const allRels: any[] = []
  for (let ri = 0; ri < results.length; ri++) {
    const r = results[ri]
    if (!r) continue
    for (const rel of (r.relationships || [])) {
      const from = idRemaps[ri].get(rel.from) || rel.from
      const to = idRemaps[ri].get(rel.to) || rel.to
      if (from !== to && allChars.find(c => c.id === from) && allChars.find(c => c.id === to)) {
        allRels.push({ from, to, type: rel.type })
      }
    }
  }

  const uniqueRels = allRels.filter((r, i) =>
    allRels.findIndex(x => x.from === r.from && x.to === r.to) === i
  )

  // LLM sometimes returns literal string "null" instead of JSON null
  const cleanStr = (v: any) => (!v || v === 'null' || v === 'none' || v === 'unknown' || v === 'не указано') ? null : String(v)

  return {
    title: cleanStr(first.title),
    author: cleanStr(first.author),
    characters: allChars,
    relationships: uniqueRels,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { text, title, author } = await req.json()
    if (!text || text.trim().length < 100) {
      return NextResponse.json({ error: 'Текст слишком короткий.' }, { status: 400 })
    }

    const supabase = getAdminClient()
    const { data: book, error: bookError } = await supabase
      .from('books')
      .insert({ title: title || 'Без названия', author: author || null, source_type: 'text', text_preview: text.substring(0, 500), status: 'analyzing' })
      .select().single()
    if (bookError) throw new Error('Ошибка создания книги: ' + bookError.message)

    const extracted = await extractCharacters(text)
    const characters = extracted.characters || []
    const relationships = extracted.relationships || []

    if (characters.length === 0) {
      await supabase.from('books').update({ status: 'error', error_message: 'Персонажи не найдены' }).eq('id', book.id)
      return NextResponse.json({ error: 'Персонажи не найдены в тексте' }, { status: 400 })
    }

    const charsInsert = characters.map((c: any, i: number) => ({
      book_id: book.id,
      name: c.name,
      role: c.role || 'other',
      role_label: c.role_label || 'Персонаж',
      appearance: c.appearance || '',
      description: c.description || '',
      color: getCharacterColor(i),
      initials: getInitials(c.name),
      avatar_url: null,
      avatar_prompt: null,
    }))

    const { data: savedChars, error: charsError } = await supabase.from('characters').insert(charsInsert).select()
    if (charsError) throw new Error('Ошибка сохранения персонажей: ' + charsError.message)

    const idMap: Record<string, string> = {}
    characters.forEach((c: any, i: number) => { if (savedChars[i]) idMap[c.id] = savedChars[i].id })

    const relsInsert = relationships
      .filter((r: any) => idMap[r.from] && idMap[r.to])
      .map((r: any) => ({ book_id: book.id, from_character_id: idMap[r.from], to_character_id: idMap[r.to], type: r.type, description: null }))

    const { data: savedRels } = relsInsert.length > 0
      ? await supabase.from('relationships').insert(relsInsert).select()
      : { data: [] }

    await supabase.from('books').update({
      status: 'done',
      title: extracted.title || title || 'Без названия',
      author: extracted.author || author || null,
      characters_count: savedChars.length,
    }).eq('id', book.id)

    return NextResponse.json({ book_id: book.id, characters: savedChars, relationships: savedRels || [] })
  } catch (err) {
    console.error('[analyze]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
