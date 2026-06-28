'use client'

import { useState, useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import type { Character } from '@/types'

interface Props { character: Character; isSelected: boolean; onClick: () => void }

const ROLE_LABELS: Record<string, string> = {
  protagonist: 'Главный герой',
  antagonist: 'Антагонист',
  mentor: 'Наставник',
  supporting: 'Второстепенный',
  other: 'Персонаж',
}

export default function CharacterCard({ character, isSelected, onClick }: Props) {
  const { updateCharacterAvatar, characters } = useAppStore()
  const [loading, setLoading] = useState(false)

  const currentChar = characters.find(c => c.id === character.id) || character
  const avatarUrl = currentChar.avatar_url

  const handleGenerateAvatar = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (avatarUrl || loading) return
    setLoading(true)
    const prompt = encodeURIComponent('Portrait of ' + character.name + '. ' + character.appearance + '. Painterly illustration, soft lighting, detailed face, neutral background, high quality.')
    const url = 'https://image.pollinations.ai/prompt/' + prompt + '?width=512&height=512&nologo=true&model=flux&seed=' + Date.now()
    const img = new Image()
    img.onload = () => { updateCharacterAvatar(character.id, url); setLoading(false) }
    img.onerror = () => { setLoading(false) }
    img.src = url
  }

  const cls = isSelected
    ? 'border-purple-400 ring-2 ring-purple-400/20 shadow-lg'
    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 hover:shadow-md'

  return (
    <div onClick={onClick} className={'group relative bg-white dark:bg-gray-900 rounded-2xl border cursor-pointer transition-all duration-200 overflow-hidden ' + cls}>
      <div className="relative aspect-square overflow-hidden bg-gray-50 dark:bg-gray-800">
        {avatarUrl ? (
          <img src={avatarUrl} alt={character.name} style={{width:'100%',height:'100%',objectFit:'cover'}} />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: character.color + '15' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-medium" style={{ background: character.color + '25', color: character.color }}>
              {character.initials}
            </div>
            <button
              onClick={handleGenerateAvatar}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-full border opacity-0 group-hover:opacity-100 bg-white dark:bg-gray-900 border-gray-200 text-gray-600 hover:text-gray-900 transition-all disabled:opacity-50"
            >
              {loading ? 'Рисую...' : 'Нарисовать'}
            </button>
          </div>
        )}
        <div className="absolute top-2 right-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: character.color + '20', color: character.color, border: '1px solid ' + character.color + '30' }}>
            {character.role_label || ROLE_LABELS[character.role] || 'Персонаж'}
          </span>
        </div>
      </div>
      <div className="p-3">
        <div className="font-medium text-sm text-gray-900 dark:text-gray-100 leading-tight">{character.name}</div>
        <div className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{character.description}</div>
      </div>
    </div>
  )
}
