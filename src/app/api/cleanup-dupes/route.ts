import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Одноразовый роут — чистит анонимных персонажей из «Идиота»
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const BOOK_ID = 'bbed665d-f3a6-4c8d-9b7f-3bb54f28f7b8'

  // Сначала смотрим кто есть
  const { data: all } = await supabase
    .from('characters')
    .select('id, name, role')
    .eq('book_id', BOOK_ID)
    .order('role')

  // Удаляем всех с role = 'other' (анонимные: камердинер, полковник, господин, молодой человек и т.п.)
  const { data: deleted, error } = await supabase
    .from('characters')
    .delete()
    .eq('book_id', BOOK_ID)
    .eq('role', 'other')
    .select('id, name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    all_characters: all?.map(c => ({ name: c.name, role: c.role })),
    deleted,
  })
}
