'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useRouter } from 'next/navigation'
import { Upload, BookOpen, Sparkles, FileText, ArrowRight } from 'lucide-react'
import { useAppStore } from '@/lib/store'

export default function HomePage() {
  const router = useRouter()
  const { setIsAnalyzing, setAnalysisProgress, setError } = useAppStore()
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [step, setStep] = useState<'idle' | 'analyzing'>('idle')

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

  const handleAnalyze = async () => {
    if (!text.trim() || text.length < 100) {
      setError('Вставьте текст книги (минимум одну главу)')
      return
    }

    setIsLoading(true)
    setStep('analyzing')
    setIsAnalyzing(true)
    setAnalysisProgress('Отправляю текст на анализ...')

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка анализа')

      setAnalysisProgress('Готово!')
      router.push(`/books/${data.book_id}`)
    } catch (err) {
      setError(String(err))
      setStep('idle')
      setIsLoading(false)
      setIsAnalyzing(false)
    }
  }

  const loadDemo = () => {
    setText(DEMO_TEXT)
    setTitle('Гарри Поттер и философский камень')
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-2xl mx-auto px-4 py-16">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-purple-50 dark:bg-purple-950/40 
            text-purple-700 dark:text-purple-300 text-sm font-medium px-3 py-1.5 
            rounded-full mb-6 border border-purple-200 dark:border-purple-800">
            <Sparkles size={14} />
            AI-визуализация персонажей
          </div>
          <h1 className="text-4xl font-medium text-gray-900 dark:text-gray-50 mb-4 tracking-tight">
            Оживи персонажей книги
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 leading-relaxed">
            Загрузи фрагмент книги — нейросеть извлечёт всех героев,
            нарисует их портреты и покажет граф связей между ними
          </p>
        </div>

        {step === 'idle' ? (
          <div className="space-y-4">

            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`
                border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer
                transition-all duration-200
                ${isDragActive
                  ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30'
                  : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 bg-white dark:bg-gray-900'
                }
              `}
            >
              <input {...getInputProps()} />
              <Upload size={28} className="mx-auto mb-3 text-gray-400" />
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {isDragActive
                  ? 'Отпусти файл здесь...'
                  : 'Перетащи .txt файл или кликни для выбора'
                }
              </div>
              <div className="text-xs text-gray-400 mt-1">Поддерживается TXT</div>
            </div>

            {/* Title input */}
            <input
              type="text"
              placeholder="Название книги (необязательно)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800
                bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                placeholder:text-gray-400 focus:outline-none focus:border-purple-400
                text-sm transition-colors"
            />

            {/* Textarea */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Или вставь текст книги прямо сюда (минимум одна глава)..."
              rows={8}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800
                bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100
                placeholder:text-gray-400 focus:outline-none focus:border-purple-400
                text-sm resize-y transition-colors leading-relaxed"
            />

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleAnalyze}
                disabled={!text.trim() || isLoading}
                className="flex-1 flex items-center justify-center gap-2
                  bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed
                  text-white font-medium py-3 px-6 rounded-xl transition-colors text-sm"
              >
                <Sparkles size={16} />
                Анализировать персонажей
                <ArrowRight size={14} />
              </button>
              <button
                onClick={loadDemo}
                className="flex items-center gap-2 px-4 py-3 rounded-xl
                  border border-gray-200 dark:border-gray-800
                  bg-white dark:bg-gray-900
                  text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100
                  text-sm transition-colors"
              >
                <BookOpen size={15} />
                Демо
              </button>
            </div>

            {/* Features */}
            <div className="grid grid-cols-3 gap-3 pt-4">
              {[
                { icon: FileText, label: 'Извлечение персонажей', desc: 'Claude анализирует текст' },
                { icon: Sparkles, label: 'AI-портреты', desc: 'Gemini рисует аватары' },
                { icon: BookOpen, label: 'Граф связей', desc: 'Интерактивная визуализация' },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="bg-white dark:bg-gray-900 rounded-xl p-3 
                  border border-gray-100 dark:border-gray-800 text-center">
                  <Icon size={20} className="mx-auto mb-2 text-purple-500" />
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* Analyzing state */
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center">
            <div className="w-12 h-12 rounded-full border-2 border-purple-200 border-t-purple-600 
              animate-spin mx-auto mb-6" />
            <div className="text-base font-medium text-gray-800 dark:text-gray-200 mb-2">
              Анализирую книгу...
            </div>
            <div className="text-sm text-gray-400">
              Claude извлекает персонажей и строит карту связей
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

const DEMO_TEXT = `Гермиона Грейнджер — самая умная ученица Хогвартса, с каштановыми вьющимися волосами и большими передними зубами. Она прилежна, логична и часто выручает друзей знаниями. Гермиона — лучшая подруга Гарри Поттера и Рона Уизли.

Гарри Поттер — мальчик с тёмными растрёпанными волосами, зелёными глазами и молниеобразным шрамом на лбу. Он смелый, верный друг, обладает исключительными способностями к квиддичу. Гарри — лучший друг Рона и Гермионы, ученик профессора Дамблдора.

Рон Уизли — рыжеволосый высокий мальчик из большой семьи волшебников. Добродушный и преданный, иногда завидует успехам друзей, но всегда приходит им на помощь. Рон — лучший друг Гарри и Гермионы.

Альбус Дамблдор — высокий старец с длинной серебристой бородой и голубыми глазами за полукруглыми очками. Мудрый и добрый директор Хогвартса, наставник Гарри Поттера. Испытывает сложные отношения с профессором Снейпом.

Северус Снейп — бледный мужчина с длинными чёрными волосами и крючковатым носом. Строгий профессор зельеварения, внешне враждебный к Гарри, но с тайными мотивами. Подчиняется Дамблдору.

Драко Малфой — светловолосый мальчик с острыми чертами лица, высокомерный и злобный. Главный соперник Гарри Поттера в Хогвартсе, сын Люциуса Малфоя.`
