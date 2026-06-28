'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useRouter } from 'next/navigation'
import { Upload, BookOpen, Sparkles, FileText, ArrowRight, Search, Loader2, X } from 'lucide-react'
import { useAppStore } from '@/lib/store'

interface BookResult {
  id: string
  title: string
  author: string
  source: string
  textUrl?: string
  pageUrl?: string
  pageTitle?: string
  libUrl?: string
  gbId?: string
  coverUrl?: string | null
  textAvailable?: boolean
  languages?: string[]
}

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  libru:       { label: 'Lib.ru',       cls: 'bg-green-50 text-green-700 border-green-200' },
  gutenberg:   { label: 'Gutenberg',    cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  wikisource:  { label: 'Wikisource',   cls: 'bg-sky-50 text-sky-600 border-sky-100' },
  googlebooks: { label: 'Google Books', cls: 'bg-amber-50 text-amber-600 border-amber-100' },
  default:     { label: 'Источник',     cls: 'bg-purple-50 text-purple-600 border-purple-100' },
}

export default function HomePage() {
  const router = useRouter()
  const { setIsAnalyzing, setAnalysisProgress } = useAppStore()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<'idle' | 'analyzing'>('idle')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<BookResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isFetching, setIsFetching] = useState(false)
  const [activeTab, setActiveTab] = useState<'search' | 'manual'>('search')

  const onDrop = useCallback((files: File[]) => {
    const file = files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setText(content)
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
    }
    reader.readAsText(file, 'utf-8')
  }, [title])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.txt'] },
    multiple: false,
  })

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    setSearchResults([])
    try {
      const res = await fetch('/api/search-book?q=' + encodeURIComponent(searchQuery))
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch (err) {
      setErrorMsg('Ошибка поиска: ' + String(err))
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectBook = async (book: BookResult) => {
    if (book.source === 'googlebooks') {
      // Google Books has no full text — prefill title and switch to manual
      setTitle(book.title + (book.author ? ' — ' + book.author : ''))
      setActiveTab('manual')
      setSearchResults([])
      setErrorMsg('Google Books не предоставляет полный текст. Вставьте текст книги вручную.')
      return
    }
    setIsFetching(true)
    setTitle(book.title + (book.author ? ' — ' + book.author : ''))
    try {
      const res = await fetch('/api/fetch-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: book.id,
          source: book.source,
          pageUrl: book.pageUrl,
          pageTitle: book.pageTitle,
          libUrl: book.libUrl,
        }),
      })
      let data: any = {}
      try { data = await res.json() } catch { /* non-JSON response */ }
      if (!res.ok) throw new Error(data.error || `Ошибка загрузки (${res.status})`)
      setText(data.text)
      setActiveTab('manual')
      setSearchResults([])
    } catch (err) {
      const msg = String(err).replace(/^Error:\s*/, '')
      const clean = msg.startsWith('SyntaxError') ? 'Источник недоступен — попробуйте другой результат из списка' : msg
      setErrorMsg('Не удалось загрузить текст: ' + clean)
    } finally {
      setIsFetching(false)
    }
  }

  const handleAnalyze = async () => {
    if (!text.trim() || text.length < 100) {
      setErrorMsg('Вставьте текст книги (минимум одну главу)')
      return
    }
    setIsLoading(true)
    setStep('analyzing')
    setIsAnalyzing(true)
    setErrorMsg(null)
    setAnalysisProgress('Отправляю текст на анализ...')

    try {
      // Primary: Supabase Edge Function (no Vercel timeout limit, works in production)
      const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      let usedEdge = false
      if (supabaseUrl && supabaseAnon) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/analyze-book`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseAnon}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, title }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Ошибка Edge Function')
          setAnalysisProgress('Готово!')
          router.push('/books/' + data.book_id)
          usedEdge = true
        } catch (edgeErr) {
          console.warn('Edge function failed, falling back to local API:', edgeErr)
        }
      }
      if (usedEdge) return

      // Fallback: local /api/analyze (dev only — has timeout on Vercel free plan)
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка анализа')
      setAnalysisProgress('Готово!')
      router.push('/books/' + data.book_id)
    } catch (err) {
      setErrorMsg(String(err).replace(/^Error:\s*/, ''))
      setStep('idle')
      setIsLoading(false)
      setIsAnalyzing(false)
    }
  }

  const loadDemo = () => {
    setText(DEMO_TEXT)
    setTitle('Гарри Поттер и философский камень')
    setActiveTab('manual')
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-sm font-medium px-3 py-1.5 rounded-full mb-6 border border-purple-200 dark:border-purple-800">
            <Sparkles size={14} />
            AI-визуализация персонажей
          </div>
          <h1 className="text-4xl font-medium text-gray-900 dark:text-gray-50 mb-4 tracking-tight">
            Оживи персонажей книги
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
            Найди книгу по названию или загрузи текст — нейросеть извлечёт героев, нарисует портреты и покажет граф связей
          </p>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-3 p-4 mb-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300">
            <span className="flex-1">{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 flex-shrink-0"><X size={16} /></button>
          </div>
        )}

        {step === 'idle' ? (
          <div className="space-y-4">
            <div className="flex gap-2 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-1">
              <button onClick={() => setActiveTab('search')} className={'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ' + (activeTab === 'search' ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-gray-700')}>
                <Search size={14} className="inline mr-2" />
                Найти книгу
              </button>
              <button onClick={() => setActiveTab('manual')} className={'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ' + (activeTab === 'manual' ? 'bg-purple-600 text-white' : 'text-gray-500 hover:text-gray-700')}>
                <FileText size={14} className="inline mr-2" />
                Вставить текст
              </button>
            </div>

            {activeTab === 'search' ? (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Название или автор: Мастер и Маргарита, Tolstoy..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-purple-400 text-sm"
                  />
                  <button onClick={handleSearch} disabled={isSearching} className="px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl transition-colors">
                    {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                  </button>
                </div>

                {isFetching && (
                  <div className="flex items-center gap-3 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
                    <Loader2 size={16} className="animate-spin text-purple-500" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">Загружаю текст книги...</span>
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                    {searchResults.map((book, i) => {
                      const badge = SOURCE_BADGE[book.source] || SOURCE_BADGE.default
                      return (
                        <button key={book.id} onClick={() => handleSelectBook(book)} className={'w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ' + (i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : '')}>
                          <div className="flex items-center gap-3">
                            {book.coverUrl
                              ? <img src={book.coverUrl} alt="" className="w-9 h-12 object-cover rounded flex-shrink-0 shadow-sm" />
                              : <div className="w-9 h-12 rounded bg-gray-100 dark:bg-gray-800 flex-shrink-0 flex items-center justify-center text-gray-300 text-lg">📖</div>
                            }
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{book.title}</div>
                              <div className="text-xs text-gray-400 mt-0.5 truncate">{book.author}</div>
                              {!book.textAvailable && <div className="text-xs text-amber-500 mt-0.5">только метаданные</div>}
                            </div>
                            <span className={'text-xs px-2 py-0.5 rounded-full border flex-shrink-0 ' + badge.cls}>
                              {badge.label}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {searchResults.length === 0 && !isSearching && searchQuery && (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    Ничего не найдено. Вставьте текст вручную или попробуйте другое название.
                  </div>
                )}

                <div className="text-center">
                  <button onClick={loadDemo} className="text-sm text-purple-600 hover:text-purple-700 font-medium">
                    Попробовать демо →
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div {...getRootProps()} className={'border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ' + (isDragActive ? 'border-purple-400 bg-purple-50' : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 bg-white dark:bg-gray-900')}>
                  <input {...getInputProps()} />
                  <Upload size={24} className="mx-auto mb-2 text-gray-400" />
                  <div className="text-sm text-gray-500">Перетащи .txt файл или кликни</div>
                </div>

                <input type="text" placeholder="Название книги" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-purple-400 text-sm" />

                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Или вставь текст книги прямо сюда..." rows={8} className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-purple-400 text-sm resize-y" />

                <div className="flex gap-3">
                  <button onClick={handleAnalyze} disabled={!text.trim() || isLoading} className="flex-1 flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white font-medium py-3 px-6 rounded-xl transition-colors text-sm">
                    <Sparkles size={16} />
                    Анализировать персонажей
                    <ArrowRight size={14} />
                  </button>
                  <button onClick={loadDemo} className="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 text-sm transition-colors hover:text-gray-900">
                    <BookOpen size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
            <div className="w-12 h-12 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin mx-auto mb-6" />
            <div className="text-base font-medium text-gray-800 dark:text-gray-200 mb-2">Анализирую книгу...</div>
            <div className="text-sm text-gray-400">Claude извлекает персонажей и строит карту связей</div>
          </div>
        )}
      </div>
    </main>
  )
}

const DEMO_TEXT = `Гермиона Грейнджер — самая умная ученица Хогвартса, с каштановыми вьющимися волосами и большими передними зубами. Она прилежна, логична и часто выручает друзей знаниями. Гермиона — лучшая подруга Гарри Поттера и Рона Уизли.

Гарри Поттер — мальчик с тёмными растрёпанными волосами, зелёными глазами и молниеобразным шрамом на лбу. Он смелый, верный друг, обладает исключительными способностями к квиддичу. Гарри — лучший друг Рона и Гермионы, ученик профессора Дамблдора.

Рон Уизли — рыжеволосый высокий мальчик из большой семьи волшебников. Добродушный и преданный, иногда завидует успехам друзей, но всегда приходит им на помощь. Рон — лучший друг Гарри и Гермионы.

Альбус Дамблдор — высокий старец с длинной серебристой бородой и голубыми глазами за полукруглыми очками. Мудрый и добрый директор Хогвартса, наставник Гарри Поттера.

Северус Снейп — бледный мужчина с длинными чёрными волосами и крючковатым носом. Строгий профессор зельеварения, внешне враждебный к Гарри, но с тайными мотивами.

Драко Малфой — светловолосый мальчик с острыми чертами лица, высокомерный и злобный. Главный соперник Гарри Поттера в Хогвартсе.`
