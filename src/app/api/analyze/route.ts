import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { getCharacterColor, getInitials } from '@/lib/store'

export const maxDuration = 300

function getAdminClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const CHUNK = 8000
const OVERLAP = 800
const MAX_CHUNKS = 8  // ~56k символов = ~280 страниц романа

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

// Returns true if name looks like a real proper name vs. a descriptive epithet/nickname
// "Мышкин" → true, "белокурый" → false, "червомазый" → false
function isProperName(name: string): boolean {
  if (!name) return false
  const n = name.trim()
  // Proper names start with a capital letter and aren't just adjectives/common nouns
  const descriptivePatterns = [
    /^(белокурый|черноволосый|темноволосый|рыжий|лысый|молодой|старый|высокий|толстый|худой|маленький)/i,
    /^(червомазый|горбатый|хромой|кривой|слепой)/i,
    /^(незнакомец|незнакомка|молодой человек|старик|старуха|юноша|девушка|дама|господин|госпожа|барин|барыня)$/i,
    /^(чиновник|полковник|генерал|офицер|доктор|профессор)$/i,
  ]
  for (const p of descriptivePatterns) {
    if (p.test(n)) return false
  }
  // Proper name: starts with capital, contains a real name-like word
  return /^[А-ЯЁA-Z]/.test(n)
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
━━━ WHO TO INCLUDE — strict threshold ━━━
✓ Characters who SPEAK (have dialogue) in this fragment
✓ Characters who are DESCRIBED IN DETAIL (appearance, emotions, thoughts, motivations)
✓ Characters who ACTIVELY AFFECT THE PLOT in this fragment (not just mentioned)
✓ The title character of the book ALWAYS
✗ NEVER include characters who are only MENTIONED BY NAME in passing (e.g. "He thought of his friend Sidorov" → do NOT add Sidorov)
✗ NEVER include characters you cannot describe with at least age + gender + one distinguishing feature
Quality over quantity: 5 well-described characters are better than 15 vague ones.
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
━━━ RELATIONSHIPS — use SPECIFIC types, never generic "встреча" ━━━
For the "type" field pick the most accurate label from these examples:
  Семья: отец/дочь, мать/сын, брат/сестра, муж/жена, дядя/племянник, родственники
  Чувства: любовь, влюблённость, взаимная любовь, безответная любовь, страсть, ревность, ненависть, презрение
  Личные: друзья, лучшие друзья, соперники, враги, знакомые, покровитель/подопечный
  Власть: благодетель/должник, хозяин/слуга, работодатель/работник, опекун/подопечный
  Сюжет: соперники за любовь, деловые партнёры, сообщники, преследователь/жертва, спаситель/спасённый
Only add relationships that are CLEARLY shown in this fragment. 2-3 well-typed relations are better than 10 generic ones.
━━━ OTHER FIELDS ━━━
"name" — character name IN THE ORIGINAL LANGUAGE of the book.
  Russian book → Russian name: "Князь Мышкин", NOT "Prince Myshkin"
  English book → English name: "Harry Potter"
"author" — ONLY the real author's name explicitly mentioned in the text; null if not explicitly stated
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

  const prompt = `These characters were extracted from different parts of a book. Find DUPLICATES — same person listed twice under different names.

━━━ MOST COMMON DUPLICATE PATTERNS ━━━
1. DESCRIPTIVE NAME → REAL NAME (most important to catch):
   "белокурый" / "белокурый молодой человек" / "fair-haired man" → "Мышкин" or "Князь Мышкин"
   "черноволосый" / "черномазый" / "червомазый" → "Рогожин" or whoever is the dark-haired character
   "молодой человек" / "незнакомец" → any named character matching the description
2. NICKNAME → REAL NAME:
   "идиот" (what people call him) → the protagonist with that nickname
   "красавица" → a named beautiful character
3. PARTIAL NAME → FULL NAME:
   "Настасья" = "Настасья Филипповна"  |  "Аглая" = "Аглая Епанчина"
4. TITLE WITHOUT NAME → NAMED CHARACTER:
   "генеральша" = "Епанчина"  |  "князь" = "Мышкин"

━━━ RULE ━━━
If two entries likely refer to the same person (same gender, similar age/hair/build), they are duplicates.
KEEP the entry with the most complete REAL NAME. DELETE the descriptive/partial/nickname entry.
Do NOT merge different characters (e.g. "Генерал Епанчин" ≠ "генеральша Епанчина" — they are husband and wife).

Character list:
${list}

Return ONLY a JSON array of IDs to DELETE. If no duplicates found, return [].
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
  const shortText = text.length <= MAX_CHUNKS * (CHUNK - OVERLAP)
  if (shortText) {
    // Short text: sequential chunks with overlap (covers everything)
    let pos = 0
    while (pos < text.length && chunks.length < MAX_CHUNKS) {
      chunks.push(text.slice(pos, pos + CHUNK))
      pos += CHUNK - OVERLAP
    }
  } else {
    // Long text: distribute chunks evenly across the FULL text
    // e.g. 300k chars, 8 chunks: positions at 0%, 14%, 28%, 42%, 57%, 71%, 85%, 100%-CHUNK
    const step = Math.floor((text.length - CHUNK) / (MAX_CHUNKS - 1))
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const pos = i === MAX_CHUNKS - 1 ? text.length - CHUNK : i * step
      chunks.push(text.slice(pos, pos + CHUNK))
    }
    console.log(`[analyze] long text ${text.length} chars → ${MAX_CHUNKS} distributed chunks, step=${step}`)
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
        if (!c.id || !c.name) continue
        const existing = knownSoFar.find(k => k.id === c.id)
        if (existing) {
          // Bug fix: update name when LLM found a real name for a previously descriptive entry
          // e.g. "белокурый" → "Мышкин" (same id, now has proper name)
          if (c.name.length > existing.name.length || isProperName(c.name)) {
            existing.name = c.name
          }
          if (c.appearance && c.appearance.length > existing.appearance.length) {
            existing.appearance = c.appearance
          }
        } else {
          knownSoFar.push({ id: c.id, name: c.name, appearance: c.appearance || '' })
        }
      }
    }
  }

  const first = results[0] || {}
  const charsByName = new Map<string, any>()
  const idRemaps: Map<string, string>[] = results.map(() => new Map())
  // Track how many distinct chunks each character appears in
  const charChunkCount = new Map<string, number>()

  for (let ri = 0; ri < results.length; ri++) {
    const r = results[ri]
    if (!r) continue
    for (const c of (r.characters || [])) {
      const key = c.name?.toLowerCase().trim()
      if (!key) continue

      // Bug fix: check if LLM reused an existing ID (same person, now with real name)
      // e.g. chunk 0: {id:"belokyry", name:"белокурый"}, chunk 1: {id:"belokyry", name:"Мышкин"}
      const existingById = Array.from(charsByName.values()).find((x: any) => x.id === c.id)
      if (existingById) {
        const oldKey = existingById.name.toLowerCase().trim()
        if (oldKey !== key) {
          // Same person, now has a real/better name — update the entry
          charsByName.delete(oldKey)
          const updated = {
            ...existingById,
            name: c.name,
            role: c.role !== 'other' ? c.role : existingById.role,
            description: c.description || existingById.description,
            appearance: (c.appearance?.length ?? 0) > (existingById.appearance?.length ?? 0) ? c.appearance : existingById.appearance,
          }
          charsByName.set(key, updated)
          charChunkCount.set(existingById.id, (charChunkCount.get(existingById.id) || 1) + 1)
        }
        idRemaps[ri].set(c.id, existingById.id)
        continue
      }

      if (!charsByName.has(key)) {
        let safeId = c.id
        const taken = new Set(Array.from(charsByName.values()).map((x: any) => x.id))
        if (taken.has(safeId)) safeId = safeId + '_' + charsByName.size
        const canonical = { ...c, id: safeId }
        charsByName.set(key, canonical)
        idRemaps[ri].set(c.id, safeId)
        charChunkCount.set(safeId, 1)
      } else {
        const existingId = charsByName.get(key)!.id
        idRemaps[ri].set(c.id, existingId)
        charChunkCount.set(existingId, (charChunkCount.get(existingId) || 1) + 1)
      }
    }
  }

  let allChars = Array.from(charsByName.values())

  // Filter: remove single-mention "other" characters with vague/empty descriptions
  // These are likely characters mentioned once in passing (Киндер, Трепалов, Бискуп etc.)
  const VAGUE_DESC_PATTERNS = [
    /неясными мотивами/i,
    /^(мужчина|женщина|человек|персонаж)\s/i,
    /мало|не(известно|ясно|понятно)/i,
  ]
  const beforeFilter = allChars.length
  allChars = allChars.filter(c => {
    if (c.role !== 'other') return true // keep all non-other roles
    const chunkCount = charChunkCount.get(c.id) || 1
    if (chunkCount >= 2) return true // appears in 2+ chunks → keep
    const desc = (c.description || '') + (c.appearance || '')
    const isVague = VAGUE_DESC_PATTERNS.some(p => p.test(desc)) || desc.length < 30
    if (isVague) {
      console.log(`[analyze] filtered single-mention vague character: "${c.name}"`)
      return false
    }
    return true
  })
  if (beforeFilter !== allChars.length) {
    console.log(`[analyze] filtered ${beforeFilter - allChars.length} single-mention minor characters`)
  }

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
      // User-provided author always takes priority over LLM extraction
      author: author || extracted.author || null,
      characters_count: savedChars.length,
    }).eq('id', book.id)

    return NextResponse.json({ book_id: book.id, characters: savedChars, relationships: savedRels || [] })
  } catch (err) {
    console.error('[analyze]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
