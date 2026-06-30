import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const BOOK_ID = 'bbed665d-f3a6-4c8d-9b7f-3bb54f28f7b8'

  // Дубли и анонимные персонажи из «Идиота»
  const toDelete = [
    'белокурый',          // = Мышкин до знакомства
    'червомазый',         // = Рогожин (прозвище)
    'Епанчина',           // = генеральша Епанчина
    'Епанчин',            // = Иван Федорович Епанчин
    'чиновник',           // анонимный
    'камердинер',         // анонимный
    'полковник',          // анонимный
  ]

  const { data: deleted, error } = await supabase
    .from('characters')
    .delete()
    .eq('book_id', BOOK_ID)
    .in('name', toDelete)
    .select('id, name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Обновляем счётчик персонажей в книге
  const { count } = await supabase
    .from('characters')
    .select('*', { count: 'exact', head: true })
    .eq('book_id', BOOK_ID)

  await supabase
    .from('books')
    .update({ characters_count: count })
    .eq('id', BOOK_ID)

  return NextResponse.json({
    deleted: deleted?.map(c => c.name),
    remaining: count,
  })
}
