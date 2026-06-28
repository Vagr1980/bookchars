import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { getCharacterColor, getInitials } from '@/lib/store'

export const maxDuration = 300

function getAdminClient() {
  return createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const CHUNK = 30000
const OVERLAP = 2000

const GEMINI_KEY = process.env.GEMINI_API_KEY!
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`

async function geminiText(prompt: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
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

  const prompt = `Analyze this book fragment and extract ALL named characters and their relationships.
${knownSection}
RULES:
- If a character from ALREADY FOUND list appears here (even under a nickname/shortened name), reuse their exact id
- Each character's "appearance" must be VISUALLY UNIQUE and SPECIFIC — different hair color/style, eye color, face shape, build, age
- appearance field is in ENGLISH for AI portrait generation
- description field is in RUSSIAN

Return ONLY valid JSON without any markdown or explanation:
{
  ${isFirst ? '"title": "book title or null",\n  "author": "author or null",' : ''}
  "characters": [
    {
      "id": "unique_latin_id_no_spaces",
      "name": "Character Name",
      "role": "protagonist",
      "role_label": "Главный герой",
      "appearance": "UNIQUE physical description in English",
      "description": "Character description in Russian"
    }
  ],
  "relationships": [
    {
      "from": "character_id",
      "to": "character_id",
      "type": "relationship type in Russian"
    }
  ]
}

Role values: protagonist, antagonist, supporting, mentor, other

Fragment ${chunkIndex + 1}:
${text}`

  const raw = await geminiText(prompt)
  return safeParseChunk(raw, chunkIndex)
}

async function extractCharacters(text: string) {
  const chunks: string[] = []
  let pos = 0
  while (pos < text.length && chunks.length < 3) {
    chunks.push(text.slice(pos, pos + CHUNK))
    pos += CHUNK - OVERLAP
  }

  const results: any[] = []
  const knownSoFar: {id: string, name: string}[] = []
  for (let i = 0; i < chunks.length; i++) {
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

  return {
    title: first.title || null,
    author: first.author || null,
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
