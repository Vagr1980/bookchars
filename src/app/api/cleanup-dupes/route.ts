import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Одноразовый роут — удаляет дублирующих безымянных персонажей из «Идиота»
// После использования — удалить этот файл
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
    .from('characters')
    .delete()
    .eq('book_id', 'bbed665d-f3a6-4c8d-9b7f-3bb54f28f7b8')
    .in('name', ['Молодой человек, черноволосый', 'Молодой человек, белокурый'])
    .select('id, name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: data })
}
