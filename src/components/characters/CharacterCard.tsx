'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/store'
import type { Character } from '@/types'
import Image from 'next/image'
import { Loader2, ImageOff } from 'lucide-react'

interface Props {
  character: Character
  isSelected: boolean
  onClick: () => void
}

const ROLE_LABELS: Record<string, string> = {
  protagonist: 'Главный герой',
  antagonist: 'Антагонист',
  mentor: 'Наставник',
  supporting: 'Второстепенный',
  other: 'Персонаж',
}

export default function CharacterCard({ character, isSelected, onClick }: Props) {
  const { updateCharacterAvatar } = useAppStore()
  const [isGenerating, setIsGenerating] = useState(false)
  const [genError, setGenError] = useState(false)

  const handleGenerateAvatar = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isGenerating || character.avatar_url) return

    setIsGenerating(true)
    setGenError(false)
    try {
      const res = await fetch('/api/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: character.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      updateCharacterAvatar(character.id, data.avatar_url)
    } catch {
      setGenError(true)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div
      onClick={onClick}
      className={`
        group relative bg-white dark:bg-gray-900 rounded-2xl border cursor-pointer
        transition-all duration-200 overflow-hidden
        ${isSelected
          ? 'border-purple-400 ring-2 ring-purple-400/20 shadow-lg shadow-purple-100 dark:shadow-purple-900/20'
          : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 hover:shadow-md'
        }
      `}
    >
      {/* Avatar area */}
      <div className="relative aspect-square overflow-hidden bg-gray-50 dark:bg-gray-800">
        {character.avatar_url ? (
          <Image
            src={character.avatar_url}
            alt={character.name}
            fill
            className="object-cover"
            sizes="200px"
          />
        ) : (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: character.color + '15' }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center
                text-xl font-medium"
              style={{ background: character.color + '25', color: character.color }}
            >
              {character.initials}
            </div>
            <button
              onClick={handleGenerateAvatar}
              disabled={isGenerating}
              className="text-xs px-3 py-1.5 rounded-full border transition-all
                opacity-0 group-hover:opacity-100
                bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700
                text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100
                disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" />
                  Генерирую...
                </span>
              ) : genError ? (
                <span className="flex items-center gap-1.5">
                  <ImageOff size={11} />
                  Повторить
                </span>
              ) : (
                '✦ Нарисовать'
              )}
            </button>
          </div>
        )}

        {/* Role badge */}
        <div className="absolute top-2 right-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: character.color + '20',
              color: character.color,
              border: `1px solid ${character.color}30`
            }}
          >
            {character.role_label || ROLE_LABELS[character.role] || 'Персонаж'}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 leading-tight">
          {character.name}
        </div>
        <div className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">
          {character.description}
        </div>
      </div>
    </div>
  )
}
