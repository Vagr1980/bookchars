'use client'

import { useAppStore } from '@/lib/store'
import CharacterCard from './CharacterCard'
import type { Character, Relationship } from '@/types'
import { Sparkles } from 'lucide-react'

interface Props {
  characters: Character[]
  relationships: Relationship[]
}

export default function CharacterGrid({ characters }: Props) {
  const { selectedCharacter, setSelectedCharacter } = useAppStore()

  if (!characters.length) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">📚</div>
        <div className="text-sm">Персонажи не найдены</div>
      </div>
    )
  }

  const handleGenerateAll = async () => {
    const unprocessed = characters.filter((c) => !c.avatar_url)
    for (const char of unprocessed) {
      await fetch('/api/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: char.id }),
      })
    }
  }

  const hasUnprocessed = characters.some((c) => !c.avatar_url)

  return (
    <div>
      {/* Actions bar */}
      {hasUnprocessed && (
        <div className="flex items-center justify-between mb-4">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {characters.filter((c) => !c.avatar_url).length} портретов не сгенерировано
          </div>
          <button
            onClick={handleGenerateAll}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg
              bg-purple-50 dark:bg-purple-950/40
              text-purple-600 dark:text-purple-400
              hover:bg-purple-100 dark:hover:bg-purple-900/40
              border border-purple-200 dark:border-purple-800
              transition-colors"
          >
            <Sparkles size={13} />
            Нарисовать все
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {characters.map((char) => (
          <CharacterCard
            key={char.id}
            character={char}
            isSelected={selectedCharacter?.id === char.id}
            onClick={() =>
              setSelectedCharacter(
                selectedCharacter?.id === char.id ? null : char
              )
            }
          />
        ))}
      </div>
    </div>
  )
}
