import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractCharacters } from '@/lib/claude'
import { getCharacterColor, getInitials } from '@/lib/store'
import type { BookInsert, CharacterInsert, RelationshipInsert } from '@/types'

export const maxDuration = 60 // секунд (Vercel Pro позволяет до 300)

export async function POST(req: NextRequest) {
  try {
    const { text, title, author } = await req.json()

    if (!text || text.trim().length < 100) {
      return NextResponse.json(
        { error: 'Текст слишком короткий. Вставьте минимум одну главу.' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    // ── 1. Создаём запись книги ───────────────────────────────────────────────
    const bookInsert: BookInsert = {
      title: title || 'Без названия',
      author: author || null,
      source_type: 'text',
      text_preview: text.substring(0, 500),
      status: 'analyzing',
    }

    const { data: book, error: bookError } = await supabase
      .from('books')
      .insert(bookInsert)
      .select()
      .single()

    if (bookError) throw new Error(`Ошибка создания книги: ${bookError.message}`)

    // ── 2. Запускаем анализ через Claude ─────────────────────────────────────
    let extraction
    try {
      extraction = await extractCharacters(text)
    } catch (err) {
      // Обновляем статус книги на ошибку
      await supabase
        .from('books')
        .update({ status: 'error', error_message: String(err) })
        .eq('id', book.id)
      throw err
    }

    // ── 3. Сохраняем персонажей ───────────────────────────────────────────────
    const charactersInsert: CharacterInsert[] = extraction.characters.map((c, i) => ({
      book_id: book.id,
      name: c.name,
      role: c.role,
      role_label: c.role_label,
      appearance: c.appearance,
      description: c.description,
      color: getCharacterColor(i),
      initials: getInitials(c.name),
      avatar_url: null,
      avatar_prompt: null,
    }))

    const { data: characters, error: charsError } = await supabase
      .from('characters')
      .insert(charactersInsert)
      .select()

    if (charsError) throw new Error(`Ошибка сохранения персонажей: ${charsError.message}`)

    // ── 4. Маппим id из Claude → реальные uuid ───────────────────────────────
    // Claude возвращает логические id (harry_potter), сохраняем с реальными uuid
    const idMap: Record<string, string> = {}
    extraction.characters.forEach((ec, i) => {
      if (characters[i]) idMap[ec.id] = characters[i].id
    })

    // ── 5. Сохраняем связи ───────────────────────────────────────────────────
    const relsInsert: RelationshipInsert[] = extraction.relationships
      .filter((r) => idMap[r.from] && idMap[r.to])
      .map((r) => ({
        book_id: book.id,
        from_character_id: idMap[r.from],
        to_character_id: idMap[r.to],
        type: r.type,
        description: r.description || null,
      }))

    const { data: relationships, error: relsError } = await supabase
      .from('relationships')
      .insert(relsInsert)
      .select()

    if (relsError) throw new Error(`Ошибка сохранения связей: ${relsError.message}`)

    // ── 6. Обновляем статус книги ─────────────────────────────────────────────
    const titleFromExtraction = extraction.title || title || 'Без названия'
    await supabase
      .from('books')
      .update({
        status: 'done',
        title: titleFromExtraction,
        author: extraction.author || author || null,
        characters_count: characters.length,
      })
      .eq('id', book.id)

    return NextResponse.json({
      book_id: book.id,
      characters,
      relationships: relationships || [],
    })

  } catch (err) {
    console.error('[analyze] Error:', err)
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    )
  }
}
