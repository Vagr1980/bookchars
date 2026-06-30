import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { getCharacterColor, getInitials } from '@/lib/store'

export const maxDuration = 300

function getAdminClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const CHUNK = 8000    // llama-3.1-8b-instant: 131k TPM — 8k chars ≈ 6k tokens, fits easily
const OVERLAP = 800
const MAX_CHUNKS = 5  // покрываем ~36k символов = ~180 страниц книги

// Groq — llama-3.1-8b-instant: 500k TPD / 131k TPM (5x больше чем 70b)
async function groqText(prompt: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    })

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}))
      const msg: string = data?.error?.message || ''
      // TPD (daily) limit — no point retrying today
      if (msg.includes('per day') || msg.includes('TPD')) {
        const mins = (msg.match(/try again in (\d+)m/) || [])[1]
        throw new Error(`Дневной лимит Groq исчерпан. Попробуйте через ${mins ? mins + ' минут' : 'час'}.`)
      }
      // TPM (per-minute) limit — wait using retry-after header
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

async function extractChunk(text: string, chunkIndex: number, knownChars: {id: string, name: string}[]) {
  const isFirst = chunkIndex === 0
  const knownSection = knownChars.length > 0
    ? `\nALREADY FOUND characters (reuse their exact IDs if you see them again, do NOT create duplicates):\n${knownChars.map(c => `  id="${c.id}" name="${c.name}"`).join('\n')}\n`
    : ''

  const prompt = `Analyze this book/poem fragment and extract significant named characters and their relationships.
${knownSection}
RULES:
1. Extract ONLY characters who have a REAL NAME or a recognized title/rank (Prince, General, Doctor, etc.)
   - The TITLE CHARACTER of the book must always be included
   - In Russian folk tales: named animals (Жар-птица, Сивка-Бурка), magical creatures with names — include them
   - Named animals (horse, dog, bird with a name) — include as characters
   - NEVER extract anonymous/generic characters like "молодой человек", "пассажир", "чиновник", "старик", "незнакомец", "девушка" without a proper name — assign role "other" only if they are plot-critical and unnamed
   - Do NOT create duplicate characters for the same person with different names/nicknames
2. If a character from ALREADY FOUND list appears here (even under a nickname/shortened name), reuse their exact id
3. "role" assignment — be strict:
   - protagonist: the main hero(es) the story centers on (1-3 max)
   - antagonist: the main villain/opposing force (1-2 max)
   - mentor: guides or teaches the protagonist
   - supporting: named secondary characters who interact with main characters
   - other: only for truly minor named characters who appear once or twice
   - ANONYMOUS characters (no real name) → role MUST be "other"
4. "appearance" — STRICTLY IN ENGLISH, for AI image generation
   - Include EXPLICIT AGE or age range (e.g. "young man in his mid-20s", "middle-aged woman around 45")
   - Use ONLY details actually mentioned in the text; fill gaps plausibly from their role and era
   - MUST reflect the book's cultural/historical setting (19th century Russian novel → Russian features, period clothing)
   - Animal/creature → describe its animal body, NOT human clothing
   - Make each character VISUALLY DISTINCT: specific hair color, eye color, age, build, key feature
   - NEVER write appearance in Russian — always English only
5. "author" — ONLY the real author's name from the text. If unsure, write null
6. "description" — RUSSIAN, 1-2 sentence character summary
7. Do NOT invent characters not present in the text

Return ONLY valid JSON, no markdown:
{
  ${isFirst ? '"title": "book title or null",\n  "author": "author or null",' : ''}
  "characters": [
    {
      "id": "unique_latin_id_no_spaces",
      "name": "Character Name",
      "role": "protagonist",
      "role_label": "Главный герой",
      "appearance": "Age XX, [hair], [eyes], [build], [clothing era-appropriate], UNIQUE visual feature",
      "description": "Описание персонажа на русском"
    }
  ],
  "relationships": [
    {
      "from": "character_id",
      "to": "character_id",
      "type": "тип связи на русском"
    }
  ]
}

Role values: protagonist, antagonist, supporting, mentor, other
role_label values: Главный герой, Злодей, Второстепенный персонаж, Наставник, Персонаж

Fragment ${chunkIndex + 1}:
${text}`

  const raw = await groqText(prompt)
  return safeParseChunk(raw, chunkIndex)
}

async function extractCharacters(text: string) {
  const chunks: string[] = []
  let pos = 0
  while (pos < text.length && chunks.length < MAX_CHUNKS) {
    chunks.push(text.slice(pos, pos + CHUNK))
    pos += CHUNK - OVERLAP
  }

  const results: any[] = []
  const knownSoFar: {id: string, name: string}[] = []
  for (let i = 0; i < chunks.length; i++) {
    // Пауза между запросами — Groq free tier 12k TPM (≈1 запрос/мин)
    if (i > 0) await new Promise(r => setTimeout(r, 3000)) // 3s gap — 8b has 131k TPM
    let r: any = null
    try { r = await extractChunk(chunks[i], i, knownSoFar) }
    catch (e) { console.warn(`[analyze] chunk ${i} error:`, e) }
    results.push(r)
    if (r?.characters) {
      for (const c of r.characters) {
        if (c.id && c.name && !knownSoFar.find(k => k.id === c.id)) {
          knownSoFar.push({ id: c.id, name: c.name })
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

  const allChars = Array.from(charsByName.values())

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
