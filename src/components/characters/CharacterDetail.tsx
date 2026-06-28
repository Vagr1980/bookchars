'use client'

import type { Character, Relationship } from '@/types'
import { X } from 'lucide-react'
import { useAppStore } from '@/lib/store'

interface Props {
  character: Character
  characters: Character[]
  relationships: Relationship[]
}

const ROLE_LABELS: Record<string, string> = {
  protagonist: 'Главный герой',
  antagonist: 'Антагонист',
  mentor: 'Наставник',
  supporting: 'Второстепенный',
  other: 'Персонаж',
}

export default function CharacterDetail({ character, characters, relationships }: Props) {
  const { setSelectedCharacter, characters: storeChars } = useAppStore()

  const currentChar = storeChars.find(c => c.id === character.id) || character
  const avatarUrl = currentChar.avatar_url

  const relatedRels = relationships.filter(
    (r) => r.from_character_id === character.id || r.to_character_id === character.id
  )

  const getRelated = (rel: Relationship) => {
    const otherId = rel.from_character_id === character.id ? rel.to_character_id : rel.from_character_id
    return characters.find((c) => c.id === otherId)
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden sticky top-24">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Персонаж</span>
        <button onClick={() => setSelectedCharacter(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <X size={15} />
        </button>
      </div>

      <div className="relative aspect-square bg-gray-50 dark:bg-gray-800">
        {avatarUrl ? (
          <img src={avatarUrl} alt={character.name} style={{width:'100%',height:'100%',objectFit:'cover'}} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: character.color + '15' }}>
            <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-medium" style={{ background: character.color + '25', color: character.color }}>
              {character.initials}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">{character.name}</h2>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full mt-1 font-medium" style={{ background: character.color + '20', color: character.color, border: '1px solid ' + character.color + '30' }}>
            {character.role_label || ROLE_LABELS[character.role]}
          </span>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{character.description}</p>

        {relatedRels.length > 0 && (
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Связи ({relatedRels.length})</div>
            <div className="space-y-1.5">
              {relatedRels.map((rel) => {
                const related = getRelated(rel)
                if (!related) return null
                const isFrom = rel.from_character_id === character.id
                return (
                  <div key={rel.id} className="flex items-center gap-2 text-sm py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-800">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0" style={{ background: related.color + '25', color: related.color }}>
                      {related.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800 dark:text-gray-200">{related.name}</span>
                    </div>
                    <div className="text-xs text-gray-400 flex-shrink-0">{isFrom ? '→' : '←'} {rel.type}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
