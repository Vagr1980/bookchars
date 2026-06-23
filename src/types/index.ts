// ─── Персонаж ───────────────────────────────────────────────────────────────

export interface Character {
  id: string
  book_id: string
  name: string
  role: 'protagonist' | 'antagonist' | 'supporting' | 'mentor' | 'other'
  role_label: string
  appearance: string        // описание внешности (EN) для генерации аватара
  description: string       // характеристика персонажа (RU)
  avatar_url: string | null
  avatar_prompt: string | null
  color: string             // hex-цвет для графа
  initials: string
  created_at: string
}

export interface CharacterInsert {
  book_id: string
  name: string
  role: Character['role']
  role_label: string
  appearance: string
  description: string
  avatar_url?: string | null
  avatar_prompt?: string | null
  color: string
  initials: string
}

// ─── Связь между персонажами ─────────────────────────────────────────────────

export interface Relationship {
  id: string
  book_id: string
  from_character_id: string
  to_character_id: string
  type: string              // друг, враг, учитель, родственник, соперник...
  description: string | null
  created_at: string
}

export interface RelationshipInsert {
  book_id: string
  from_character_id: string
  to_character_id: string
  type: string
  description?: string | null
}

// ─── Книга ───────────────────────────────────────────────────────────────────

export interface Book {
  id: string
  user_id: string | null    // null = анонимная сессия
  title: string
  author: string | null
  language: 'ru' | 'en' | 'other'
  source_type: 'text' | 'pdf' | 'url'
  text_preview: string      // первые 500 символов для отображения
  status: 'pending' | 'analyzing' | 'done' | 'error'
  error_message: string | null
  characters_count: number
  created_at: string
  updated_at: string
}

export interface BookInsert {
  user_id?: string | null
  title: string
  author?: string | null
  language?: Book['language']
  source_type: Book['source_type']
  text_preview: string
  status?: Book['status']
}

// ─── API Request / Response ──────────────────────────────────────────────────

export interface AnalyzeRequest {
  text: string
  title?: string
  author?: string
  book_id?: string          // если книга уже создана
}

export interface AnalyzeResponse {
  book_id: string
  characters: Character[]
  relationships: Relationship[]
  error?: string
}

export interface GenerateAvatarRequest {
  character_id: string
  prompt: string
}

export interface GenerateAvatarResponse {
  character_id: string
  avatar_url: string
  error?: string
}

// ─── Граф ────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string
  character: Character
  x: number
  y: number
  vx: number
  vy: number
  fx?: number | null
  fy?: number | null
}

export interface GraphEdge {
  id: string
  source: string            // character id
  target: string            // character id
  type: string
  description: string | null
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ─── Store (Zustand) ─────────────────────────────────────────────────────────

export interface AppStore {
  currentBook: Book | null
  characters: Character[]
  relationships: Relationship[]
  selectedCharacter: Character | null
  isAnalyzing: boolean
  analysisProgress: string
  error: string | null

  setCurrentBook: (book: Book | null) => void
  setCharacters: (chars: Character[]) => void
  setRelationships: (rels: Relationship[]) => void
  setSelectedCharacter: (char: Character | null) => void
  setIsAnalyzing: (v: boolean) => void
  setAnalysisProgress: (msg: string) => void
  setError: (err: string | null) => void
  updateCharacterAvatar: (characterId: string, avatarUrl: string) => void
  reset: () => void
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

export type ApiError = {
  error: string
  code?: string
}
