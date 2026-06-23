import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createClient()
    const { id } = params

    const [bookRes, charsRes, relsRes] = await Promise.all([
      supabase.from('books').select('*').eq('id', id).single(),
      supabase.from('characters').select('*').eq('book_id', id).order('created_at'),
      supabase.from('relationships').select('*').eq('book_id', id),
    ])

    if (bookRes.error) {
      return NextResponse.json({ error: 'Книга не найдена' }, { status: 404 })
    }

    return NextResponse.json({
      book: bookRes.data,
      characters: charsRes.data || [],
      relationships: relsRes.data || [],
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
