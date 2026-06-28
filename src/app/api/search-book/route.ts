import { NextRequest, NextResponse } from 'next/server'

// ── Google Books ──────────────────────────────────────────────────────────────
async function searchGoogleBooks(query: string) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8&langRestrict=ru&printType=books`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.items || []).map((item: any) => {
    const info = item.volumeInfo || {}
    return {
      id: 'gb_' + item.id,
      title: info.title || 'Без названия',
      author: (info.authors || []).join(', ') || 'Автор неизвестен',
      source: 'googlebooks',
      coverUrl: info.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
      description: info.description?.slice(0, 200) || null,
      gbId: item.id,
      textAvailable: false,
    }
  })
}

// ── Project Gutenberg ─────────────────────────────────────────────────────────
async function searchGutenberg(query: string) {
  const res = await fetch(`https://gutendex.com/books/?search=${encodeURIComponent(query)}&mime_type=text/plain`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results || []).slice(0, 5).map((book: any) => ({
    id: String(book.id),
    title: book.title,
    author: book.authors?.[0]?.name || 'Unknown',
    source: 'gutenberg',
    coverUrl: book.formats?.['image/jpeg'] || null,
    textAvailable: true,
    textUrl: book.formats?.['text/plain; charset=utf-8']
      || book.formats?.['text/plain; charset=us-ascii']
      || book.formats?.['text/plain'],
  })).filter((b: any) => b.textUrl)
}

// ── Wikisource RU ─────────────────────────────────────────────────────────────
async function searchWikisource(query: string) {
  const url = `https://ru.wikisource.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srnamespace=0&format=json&srlimit=5&origin=*`
  const res = await fetch(url, { headers: { 'User-Agent': 'BookChars/1.0' } })
  if (!res.ok) return []
  const data = await res.json()
  return (data.query?.search || []).map((item: any) => ({
    id: 'ws_' + item.pageid,
    title: item.title,
    author: '',
    source: 'wikisource',
    coverUrl: null,
    textAvailable: true,
    pageTitle: item.title,
  }))
}

// ── Curated Russian classics (lib.ru) ─────────────────────────────────────────
const RUSSIAN_CLASSICS = [
  // Толстой
  { id: 'ru_war_peace',    title: 'Война и мир',             author: 'Лев Толстой',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/TOLSTOJ/war_and_peace.txt',     keywords: ['война и мир', 'war and peace', 'толстой', 'tolstoy'] },
  { id: 'ru_anna_kar',     title: 'Анна Каренина',           author: 'Лев Толстой',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/TOLSTOJ/anna_karenina.txt',     keywords: ['анна каренина', 'anna karenina', 'толстой', 'tolstoy'] },
  { id: 'ru_voskr',        title: 'Воскресение',             author: 'Лев Толстой',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/TOLSTOJ/voskresenie.txt',       keywords: ['воскресение', 'resurrection', 'толстой', 'tolstoy'] },
  // Достоевский
  { id: 'ru_prestup',      title: 'Преступление и наказание', author: 'Фёдор Достоевский', source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/DOSTOEWSKIJ/prestuplenij.txt', keywords: ['преступление', 'наказание', 'crime', 'punishment', 'достоевский', 'dostoevsky'] },
  { id: 'ru_idiot',        title: 'Идиот',                   author: 'Фёдор Достоевский', source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/DOSTOEWSKIJ/idiot.txt',         keywords: ['идиот', 'idiot', 'достоевский', 'dostoevsky'] },
  { id: 'ru_brat_kar',     title: 'Братья Карамазовы',       author: 'Фёдор Достоевский', source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/DOSTOEWSKIJ/brat_karamazovy.txt', keywords: ['братья карамазовы', 'karamazov', 'достоевский', 'dostoevsky'] },
  { id: 'ru_besy',         title: 'Бесы',                    author: 'Фёдор Достоевский', source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/DOSTOEWSKIJ/besy.txt',          keywords: ['бесы', 'demons', 'достоевский', 'dostoevsky'] },
  { id: 'ru_uniz',         title: 'Униженные и оскорблённые', author: 'Фёдор Достоевский', source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/DOSTOEWSKIJ/unizhennye.txt',   keywords: ['униженные', 'оскорблённые', 'достоевский', 'dostoevsky'] },
  // Чехов
  { id: 'ru_tri_sestry',   title: 'Три сестры',              author: 'Антон Чехов',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/CHEHOW/tri_sestry.txt',         keywords: ['три сестры', 'three sisters', 'чехов', 'chekhov'] },
  { id: 'ru_vishnya',      title: 'Вишнёвый сад',            author: 'Антон Чехов',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/CHEHOW/vishnevy_sad.txt',       keywords: ['вишнёвый сад', 'cherry orchard', 'чехов', 'chekhov'] },
  { id: 'ru_dyadya',       title: 'Дядя Ваня',               author: 'Антон Чехов',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/CHEHOW/djadja_wanja.txt',      keywords: ['дядя ваня', 'uncle vanya', 'чехов', 'chekhov'] },
  { id: 'ru_chaika',       title: 'Чайка',                   author: 'Антон Чехов',       source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/CHEHOW/chaika.txt',             keywords: ['чайка', 'seagull', 'чехов', 'chekhov'] },
  // Булгаков
  { id: 'ru_master',       title: 'Мастер и Маргарита',      author: 'Михаил Булгаков',   source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/BULGAKOW/master.txt',           keywords: ['мастер', 'маргарита', 'master', 'margarita', 'булгаков', 'bulgakov'] },
  { id: 'ru_white_guard',  title: 'Белая гвардия',           author: 'Михаил Булгаков',   source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/BULGAKOW/bel_gwardija.txt',    keywords: ['белая гвардия', 'white guard', 'булгаков', 'bulgakov'] },
  // Пушкин
  { id: 'ru_onegin',       title: 'Евгений Онегин',          author: 'Александр Пушкин',  source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/PUSHKIN/onegin.txt',            keywords: ['онегин', 'onegin', 'пушкин', 'pushkin'] },
  { id: 'ru_kapitan',      title: 'Капитанская дочка',       author: 'Александр Пушкин',  source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/PUSHKIN/kapitan.txt',           keywords: ['капитанская дочка', 'captain', 'пушкин', 'pushkin'] },
  // Гоголь
  { id: 'ru_dead_souls',   title: 'Мёртвые души',            author: 'Николай Гоголь',    source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/GOGOL/mertvye_dushi.txt',      keywords: ['мёртвые', 'мертвые', 'души', 'dead souls', 'гоголь', 'gogol'] },
  { id: 'ru_revizor',      title: 'Ревизор',                 author: 'Николай Гоголь',    source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/GOGOL/revizor.txt',             keywords: ['ревизор', 'inspector', 'гоголь', 'gogol'] },
  { id: 'ru_taras',        title: 'Тарас Бульба',            author: 'Николай Гоголь',    source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/GOGOL/taras_bulba.txt',        keywords: ['тарас бульба', 'taras bulba', 'гоголь', 'gogol'] },
  // Тургенев
  { id: 'ru_ottsy',        title: 'Отцы и дети',             author: 'Иван Тургенев',     source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/TURGENEW/ottsy_i_deti.txt',    keywords: ['отцы и дети', 'fathers and sons', 'тургенев', 'turgenev'] },
  { id: 'ru_mumu',         title: 'Муму',                    author: 'Иван Тургенев',     source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/TURGENEW/mumu.txt',             keywords: ['муму', 'mumu', 'тургенев', 'turgenev'] },
  // Гончаров
  { id: 'ru_oblomov',      title: 'Обломов',                 author: 'Иван Гончаров',     source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/GONCHAROW/oblomow.txt',        keywords: ['обломов', 'oblomov', 'гончаров', 'goncharov'] },
  // Лермонтов
  { id: 'ru_geroi',        title: 'Герой нашего времени',    author: 'Михаил Лермонтов',  source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/LERMONTOW/geroj.txt',          keywords: ['герой', 'нашего', 'времени', 'hero of our time', 'лермонтов', 'lermontov'] },
  // Ершов
  { id: 'ru_konek',        title: 'Конёк-горбунок',          author: 'Пётр Ершов',        source: 'wikisource', textAvailable: true, pageTitle: 'Конёк-горбунок (Ершов)/1868 (ВТ)',        keywords: ['конёк', 'горбунок', 'konek', 'ершов', 'ershov'] },
  // Горький
  { id: 'ru_na_dne',       title: 'На дне',                  author: 'Максим Горький',    source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/GORKIJ/na_dne.txt',            keywords: ['на дне', 'lower depths', 'горький', 'gorky'] },
  // Островский
  { id: 'ru_groza',        title: 'Гроза',                   author: 'Александр Островский', source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/OSTROWSKIJ/groza.txt',     keywords: ['гроза', 'thunderstorm', 'островский', 'ostrovsky'] },
  // Бунин
  { id: 'ru_dark_al',      title: 'Тёмные аллеи',            author: 'Иван Бунин',        source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/BUNIN/dark_alleys.txt',        keywords: ['тёмные аллеи', 'темные аллеи', 'dark alleys', 'бунин', 'bunin'] },
  // Куприн
  { id: 'ru_granat',       title: 'Гранатовый браслет',      author: 'Александр Куприн',  source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/KUPRIN/granat.txt',            keywords: ['гранатовый браслет', 'garnet bracelet', 'куприн', 'kuprin'] },
  // Набоков
  { id: 'ru_lolita',       title: 'Лолита',                  author: 'Владимир Набоков',  source: 'libru', textAvailable: true, libUrl: 'http://lib.ru/LITRA/NABOKOW/lolita.txt',           keywords: ['лолита', 'lolita', 'набоков', 'nabokov'] },
]

function searchRussianClassics(query: string) {
  const q = query.toLowerCase()
  return RUSSIAN_CLASSICS.filter(b =>
    b.keywords.some(kw => q.includes(kw) || kw.includes(q.split(' ')[0]))
  ).map(b => ({ ...b, coverUrl: null }))
}

// ── Gutenberg popular books ───────────────────────────────────────────────────
const GUTENBERG_POPULAR: Record<string, { id: string; title: string; author: string }[]> = {
  dostoevsky: [
    { id: '2638',  title: 'The Idiot',               author: 'Dostoyevsky, Fyodor' },
    { id: '2197',  title: 'Crime and Punishment',    author: 'Dostoyevsky, Fyodor' },
    { id: '28054', title: 'The Brothers Karamazov',  author: 'Dostoyevsky, Fyodor' },
  ],
  tolstoy: [
    { id: '2600', title: 'War and Peace',  author: 'Tolstoy, Leo' },
    { id: '1399', title: 'Anna Karenina', author: 'Tolstoy, Leo' },
  ],
  shakespeare: [
    { id: '1524', title: 'Hamlet',         author: 'Shakespeare, William' },
    { id: '1513', title: 'Romeo and Juliet', author: 'Shakespeare, William' },
    { id: '1533', title: 'Macbeth',        author: 'Shakespeare, William' },
  ],
  dickens: [
    { id: '98',   title: 'A Tale of Two Cities',  author: 'Dickens, Charles' },
    { id: '1400', title: 'Great Expectations',    author: 'Dickens, Charles' },
  ],
  chekhov: [
    { id: '13415', title: 'The Cherry Orchard', author: 'Chekhov, Anton' },
  ],
}

function findGutenbergPopular(query: string) {
  const q = query.toLowerCase()
  for (const [key, books] of Object.entries(GUTENBERG_POPULAR)) {
    if (q.includes(key) || books.some(b => q.includes(b.title.toLowerCase().split(' ')[0]))) {
      return books.map(b => ({
        ...b,
        source: 'gutenberg',
        textAvailable: true,
        coverUrl: `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}.cover.medium.jpg`,
        textUrl: `https://www.gutenberg.org/files/${b.id}/${b.id}-0.txt`,
      }))
    }
  }
  return []
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const query = req.nextUrl.searchParams.get('q')
    if (!query) return NextResponse.json({ error: 'Query required' }, { status: 400 })

    const [googleResults, gutenbergResults, wikisourceResults] = await Promise.allSettled([
      searchGoogleBooks(query),
      searchGutenberg(query),
      searchWikisource(query),
    ])

    const russian   = searchRussianClassics(query)
    const popular   = findGutenbergPopular(query)
    const google    = googleResults.status    === 'fulfilled' ? googleResults.value    : []
    const gutenberg = gutenbergResults.status === 'fulfilled' ? gutenbergResults.value : []
    const wiki      = wikisourceResults.status === 'fulfilled' ? wikisourceResults.value : []

    // Merge, deduplicate by id
    const seen = new Set<string>()
    const all = [...russian, ...popular, ...gutenberg, ...wiki, ...google]
    const results = all.filter(b => {
      if (seen.has(b.id)) return false
      seen.add(b.id)
      return true
    }).slice(0, 12)

    return NextResponse.json({ results })
  } catch (err) {
    console.error('[search-book]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
