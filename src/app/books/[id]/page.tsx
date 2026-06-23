'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAppStore } from '@/lib/store'
import CharacterGrid from '@/components/characters/CharacterGrid'
import CharacterDetail from '@/components/characters/CharacterDetail'
import RelationshipGraph from '@/components/graph/RelationshipGraph'
import type { Book, Character, Relationship } from '@/types'
import { BookOpen, Users, Share2, RefreshCw } from 'lucide-react'
import Link from 'next/link'

type Tab = 'characters' | 'graph'

export default function BookPage() {
  const params = useParams()
  const bookId = params.id as string
  const { setCharacters, setRelationships, selectedCharacter, setCurrentBook } = useAppStore()

  const [book, setBook] = useState<Book | null>(null)
  const [characters, setLocalChars] = useState<Character[]>([])
  const [relationships, setLocalRels] = useState<Relationship[]>([])
  const [tab, setTab] = useState<Tab>('characters')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!bookId) return
    loadBook()
  }, [bookId])

  const loadBook = async () => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/books/${bookId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setBook(data.book)
      setLocalChars(data.characters)
      setLocalRels(data.relationships)
      setCurrentBook(data.book)
      setCharacters(data.characters)
      setRelationships(data.relationships)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin mx-auto mb-4" />
          <div className="text-sm text-gray-400">Загружаю данные...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">📚</div>
          <div className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">Что-то пошло не так</div>
          <div className="text-sm text-gray-500 mb-6">{error}</div>
          <Link href="/" className="text-sm text-purple-600 hover:text-purple-700 font-medium">
            ← Вернуться на главную
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">

      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <BookOpen size={20} />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {book?.title || 'Без названия'}
            </h1>
            {book?.author && (
              <div className="text-xs text-gray-400">{book.author}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Users size={13} />
            {characters.length} персонажей
          </div>
          <button
            onClick={loadBook}
            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 
              rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Обновить"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 flex gap-0 border-t border-gray-100 dark:border-gray-800">
          {(['characters', 'graph'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`
                px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
                ${tab === t
                  ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }
              `}
            >
              {t === 'characters' ? 'Персонажи' : 'Граф связей'}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {tab === 'characters' ? (
          <div className="flex gap-6">
            <div className="flex-1 min-w-0">
              <CharacterGrid
                characters={characters}
                relationships={relationships}
              />
            </div>
            {selectedCharacter && (
              <div className="w-80 flex-shrink-0">
                <CharacterDetail
                  character={selectedCharacter}
                  characters={characters}
                  relationships={relationships}
                />
              </div>
            )}
          </div>
        ) : (
          <RelationshipGraph
            characters={characters}
            relationships={relationships}
          />
        )}
      </div>
    </div>
  )
}
