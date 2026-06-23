import { create } from 'zustand'
import type { AppStore, Book, Character, Relationship } from '@/types'

const COLORS = [
  '#7F77DD', '#1D9E75', '#D85A30', '#378ADD',
  '#D4537E', '#639922', '#BA7517', '#534AB7',
  '#0F6E56', '#993C1D'
]

export const useAppStore = create<AppStore>((set) => ({
  currentBook: null,
  characters: [],
  relationships: [],
  selectedCharacter: null,
  isAnalyzing: false,
  analysisProgress: '',
  error: null,

  setCurrentBook: (book) => set({ currentBook: book }),
  setCharacters: (chars) => set({ characters: chars }),
  setRelationships: (rels) => set({ relationships: rels }),
  setSelectedCharacter: (char) => set({ selectedCharacter: char }),
  setIsAnalyzing: (v) => set({ isAnalyzing: v }),
  setAnalysisProgress: (msg) => set({ analysisProgress: msg }),
  setError: (err) => set({ error: err }),

  updateCharacterAvatar: (characterId, avatarUrl) =>
    set((state) => ({
      characters: state.characters.map((c) =>
        c.id === characterId ? { ...c, avatar_url: avatarUrl } : c
      ),
      selectedCharacter:
        state.selectedCharacter?.id === characterId
          ? { ...state.selectedCharacter, avatar_url: avatarUrl }
          : state.selectedCharacter,
    })),

  reset: () =>
    set({
      currentBook: null,
      characters: [],
      relationships: [],
      selectedCharacter: null,
      isAnalyzing: false,
      analysisProgress: '',
      error: null,
    }),
}))

// ─── Утилиты ─────────────────────────────────────────────────────────────────

export function getCharacterColor(index: number): string {
  return COLORS[index % COLORS.length]
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()
}
