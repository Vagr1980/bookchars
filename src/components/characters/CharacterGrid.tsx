'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import type { Character, Relationship } from '@/types'
import { Sparkles, Loader2 } from 'lucide-react'
import CharacterCard from './CharacterCard'

interface Props {
  characters: Character[]
  relationships: Relationship[]
  bookId?: string
}

export default function CharacterGrid({ characters, bookId }: Props) {
  const { selectedCharacter, setSelectedCharacter, updateCharacterAvatar, characters: storeChars } = useAppStore()
  const [isGeneratingAll, setIsGeneratingAll] = useState(false)
  const [generatingCount, setGeneratingCount] = useState(0)

  const currentChars = characters.map(c => storeChars.find(s => s.id === c.id) || c)
  const hasUnprocessed = currentChars.some(c => !c.avatar_url)

  const handleGenerateAll = async () => {
    const unprocessed = currentChars.filter(c => !c.avatar_url)
    if (!unprocessed.length || isGeneratingAll) return

    setIsGeneratingAll(true)
    setGeneratingCount(0)

    for (let i = 0; i < unprocessed.length; i++) {
      const char = unprocessed[i]
      setGeneratingCount(i + 1)

      // Small gap between requests so Pollinations queue clears
      if (i > 0) await new Promise(r => setTimeout(r, 5000))

      try {
        const res = await fetch('/api/generate-avatar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ character_id: char.id }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.avatar_url) updateCharacterAvatar(char.id, data.avatar_url)
        }
      } catch {
        // continue to next character on error
      }
    }

    setIsGeneratingAll(false)
    setGeneratingCount(0)
  }

  if (!characters.length) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">📚</div>
        <div className="text-sm">Персонажи не найдены</div>
      </div>
    )
  }

  return (
    <div>
      {hasUnprocessed && (
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {isGeneratingAll 
              ? `Рисую ${generatingCount} из ${currentChars.filter(c => !c.avatar_url).length + generatingCount - 1}...`
              : `${currentChars.filter(c => !c.avatar_url).length} портретов не сгенерировано`
            }
          </div>
          <button
            onClick={handleGenerateAll}
            disabled={isGeneratingAll}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-800 transition-colors disabled:opacity-50"
          >
            {isGeneratingAll ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {isGeneratingAll ? 'Рисую...' : 'Нарисовать все'}
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {characters.map((char) => (
          <CharacterCard
            key={char.id}
            character={char}
            isSelected={selectedCharacter?.id === char.id}
            onClick={() => setSelectedCharacter(selectedCharacter?.id === char.id ? null : char)}
          />
        ))}
      </div>
    </div>
  )
}
