import { NextRequest, NextResponse } from 'next/server'
import http from 'http'
import https from 'https'

export const maxDuration = 30

// Native Node.js HTTP client — more lenient than undici/fetch for old servers like lib.ru
function nodeGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,text/plain,*/*',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'ru-RU,ru;q=0.9',
        'Connection': 'close',
      },
      timeout: 20000,
    }
    const req = client.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.on('error', reject)
    req.end()
  })
}

// ── Gutenberg ─────────────────────────────────────────────────────────────────
const GUTENBERG_MIRRORS = [
  'https://gutenberg.pglaf.org',
  'https://mirror.csclub.uwaterloo.ca/gutenberg',
  'https://gutenberg.readingroo.ms',
]

async function fetchGutenbergText(bookId: string): Promise<string> {
  const urls = [
    `https://www.gutenberg.org/files/${bookId}/${bookId}-0.txt`,
    `https://www.gutenberg.org/files/${bookId}/${bookId}.txt`,
    `https://www.gutenberg.org/cache/epub/${bookId}/pg${bookId}.txt`,
    ...GUTENBERG_MIRRORS.map(m => `${m}/files/${bookId}/${bookId}-0.txt`),
  ]
  const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; BookChars/1.0)' }
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) continue
      const text = await res.text()
      if (text.length > 1000) return cleanGutenbergText(text)
    } catch { continue }
  }
  throw new Error(`Не удалось загрузить книгу ${bookId} из Project Gutenberg`)
}

function cleanGutenbergText(full: string): string {
  const starts = ['*** START OF THE PROJECT', '*** START OF THIS PROJECT', '*END*THE SMALL PRINT']
  const ends   = ['*** END OF THE PROJECT',   '*** END OF THIS PROJECT',   'End of Project Gutenberg']
  let text = full
  for (const m of starts) {
    const i = text.indexOf(m)
    if (i !== -1) { text = text.slice(text.indexOf('\n', i) + 1); break }
  }
  for (const m of ends) {
    const i = text.indexOf(m)
    if (i !== -1) { text = text.slice(0, i); break }
  }
  return text.trim()
}

// ── lib.ru ─────────────────────────────────────────────────────────────────────
async function fetchLibRuText(url: string): Promise<string> {
  // lib.ru only serves http (not https)
  const httpUrl = url.replace(/^https:/, 'http:')

  // Use native Node.js http — undici (used by fetch) chokes on lib.ru's malformed chunked encoding
  const buf = await nodeGet(httpUrl)

  // Sniff encoding: try windows-1251 first (most common on lib.ru), fall back to utf-8
  let text = ''
  for (const enc of ['windows-1251', 'koi8-r', 'utf-8'] as const) {
    try {
      text = new TextDecoder(enc).decode(buf)
      // Basic heuristic: if decoded text has Cyrillic, it's likely correct
      if (/[а-яёА-ЯЁ]/.test(text)) break
    } catch { continue }
  }

  // Strip HTML tags if the response is an HTML page
  if (text.trimStart().startsWith('<') || text.includes('</html>')) {
    text = stripHtml(text)
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{4,}/g, '\n\n\n')
  if (text.length < 500) throw new Error('Текст слишком короткий — возможно lib.ru временно недоступен')
  return text.trim()
}

function stripHtml(html: string): string {
  // Remove scripts, styles, head
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
  // Paragraph/line breaks → newlines
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  // Collapse excessive blank lines
  text = text.replace(/\n{4,}/g, '\n\n\n')
  return text.trim()
}

// ── Wikisource RU ─────────────────────────────────────────────────────────────
const WS_HEADERS = { 'User-Agent': 'BookChars/1.0 (educational project)' }

async function wikisourceJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: WS_HEADERS })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return null }
}

// Clean raw wikitext into readable plain text
function cleanWikitext(raw: string): string {
  // Skip redirect pages
  if (/^#(REDIRECT|ПЕРЕНАПРАВЛЕНИЕ)/i.test(raw.trim())) return ''

  // ── Strategy 1: extract <poem>…</poem> blocks (Wikisource poetry) ──────────
  // Poems on Wikisource live inside <poem> tags — grab them directly,
  // bypassing all the deeply-nested {{template}} complexity.
  const poemParts: string[] = []
  const poemRe = /<poem[^>]*>([\s\S]*?)<\/poem>/gi
  let m: RegExpExecArray | null
  while ((m = poemRe.exec(raw)) !== null) poemParts.push(m[1])

  if (poemParts.length > 0) {
    let text = poemParts.join('\n\n')
    text = text.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1') // wiki links
    for (let i = 0; i < 3; i++) text = text.replace(/\{\{[^{}]*\}\}/g, '') // templates
    text = text.replace(/<[^>]+>/g, '') // remaining tags
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    return text.replace(/\n{4,}/g, '\n\n\n').trim()
  }

  // ── Strategy 2: general prose cleanup ─────────────────────────────────────
  let text = raw
  text = text.replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, '')
  text = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  text = text.replace(/<ref[^>]*\/>/gi, '')
  text = text.replace(/<!--[\s\S]*?-->/g, '')
  for (let i = 0; i < 5; i++) text = text.replace(/\{\{[^{}]*\}\}/g, '')
  text = text.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
  text = text.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
  text = text.replace(/\[https?:\/\/[^\s\]]+\]/g, '')
  text = text.replace(/={2,}\s*([^=\n]+?)\s*={2,}/g, '\n\n$1\n\n')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
}

async function fetchWikisourcePage(title: string): Promise<string> {
  // Use wikitext — much cleaner than HTML (no nested-div nightmare)
  const url = `https://ru.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&origin=*`
  const data = await wikisourceJson(url)
  if (!data?.parse?.wikitext?.['*']) return ''
  return cleanWikitext(data.parse.wikitext['*'] as string)
}

async function fetchWikisourceText(pageTitle: string): Promise<string> {
  // If this is a sub-page (e.g. "Война и мир (Толстой)/Том 3"), find the root
  const rootTitle = pageTitle.includes('/') ? pageTitle.split('/')[0] : pageTitle

  // Get sub-pages list from root
  const queryUrl = `https://ru.wikisource.org/w/api.php?action=query&list=allpages&apprefix=${encodeURIComponent(rootTitle + '/')}&aplimit=30&apnamespace=0&format=json&origin=*`
  const queryData = await wikisourceJson(queryUrl)
  const subPages: string[] = ((queryData?.query?.allpages || []) as any[])
    .map((p: any) => p.title)
    .filter((t: string) => !t.match(/обсуждение|discuss/i))
    .slice(0, 12)

  // Fetch root + all sub-pages with small delay to avoid rate limiting
  const allTitles = [rootTitle, ...subPages]
  const texts: string[] = []
  for (const t of allTitles) {
    const txt = await fetchWikisourcePage(t).catch(() => '')
    texts.push(txt)
    if (texts.length > 1) await new Promise(r => setTimeout(r, 300)) // polite delay
  }

  const full = texts.filter(Boolean).join('\n\n')
  if (full.length < 500) throw new Error('Текст не найден на Wikisource — попробуйте другой источник')
  return full
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { bookId, source, pageUrl, pageTitle, libUrl } = await req.json()

    let text = ''

    if (source === 'gutenberg') {
      if (!bookId) return NextResponse.json({ error: 'bookId required' }, { status: 400 })
      text = await fetchGutenbergText(bookId)

    } else if (source === 'libru') {
      if (!libUrl) return NextResponse.json({ error: 'libUrl required' }, { status: 400 })
      text = await fetchLibRuText(libUrl)

    } else if (source === 'wikisource') {
      if (!pageTitle) return NextResponse.json({ error: 'pageTitle required' }, { status: 400 })
      text = await fetchWikisourceText(pageTitle)

    } else if (source === 'googlebooks') {
      // Google Books doesn't provide full text — return helpful error
      return NextResponse.json({
        error: 'Google Books не предоставляет полный текст. Скопируйте текст вручную или выберите книгу из другого источника.',
        noText: true,
      }, { status: 422 })

    } else {
      return NextResponse.json({ error: 'Неизвестный источник: ' + source }, { status: 400 })
    }

    if (!text || text.length < 500) {
      return NextResponse.json({ error: 'Слишком мало текста получено' }, { status: 400 })
    }

    return NextResponse.json({ text, length: text.length })
  } catch (err) {
    console.error('[fetch-book]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
