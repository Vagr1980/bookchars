# BookChars — AI-визуализатор персонажей книг

Загрузи фрагмент книги — Claude извлечёт персонажей, Gemini нарисует портреты, D3 построит граф связей.

## Стек

| Слой | Технология |
|---|---|
| Frontend | Next.js 14 + Tailwind CSS |
| State | Zustand |
| Graph | D3.js (force simulation) |
| LLM | Claude Sonnet (Anthropic) |
| Аватары | Gemini 2.5 Flash Image (Google, 500/день бесплатно) |
| БД + Storage | Supabase (PostgreSQL + S3-совместимое хранилище) |
| Хостинг | Vercel |

## Быстрый старт

### 1. Клонировать и установить зависимости

```bash
git clone <repo>
cd bookchars
npm install
```

### 2. Настроить переменные окружения

```bash
cp .env.example .env.local
# Заполнить значения в .env.local
```

Нужные ключи:
- **ANTHROPIC_API_KEY** — [console.anthropic.com](https://console.anthropic.com)
- **GEMINI_API_KEY** — [aistudio.google.com](https://aistudio.google.com/app/apikey) (бесплатно)
- **NEXT_PUBLIC_SUPABASE_URL** и ключи — [supabase.com](https://supabase.com)

### 3. Создать базу данных Supabase

```bash
# Установить Supabase CLI
npm install -g supabase

# Инициализировать и применить миграции
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Или выполнить SQL из `supabase/migrations/001_init.sql` напрямую через SQL Editor в Supabase Dashboard.

### 4. Запустить локально

```bash
npm run dev
# http://localhost:3000
```

### 5. Деплой на Vercel

```bash
npm install -g vercel
vercel --prod
# Добавить env-переменные в Vercel Dashboard
```

## Структура проекта

```
src/
├── app/
│   ├── page.tsx                  # Главная — загрузка текста
│   ├── books/[id]/page.tsx       # Страница книги с персонажами и графом
│   └── api/
│       ├── analyze/route.ts      # POST /api/analyze — извлечение персонажей
│       ├── generate-avatar/      # POST /api/generate-avatar
│       └── books/[id]/route.ts   # GET /api/books/:id
├── components/
│   ├── characters/
│   │   ├── CharacterCard.tsx
│   │   ├── CharacterGrid.tsx
│   │   └── CharacterDetail.tsx
│   └── graph/
│       └── RelationshipGraph.tsx
├── lib/
│   ├── claude.ts                 # Anthropic API — анализ текста
│   ├── gemini.ts                 # Google Gemini — генерация аватаров
│   ├── store.ts                  # Zustand store
│   └── supabase/
│       ├── client.ts             # Браузерный клиент
│       └── server.ts             # Серверный клиент
└── types/index.ts                # TypeScript типы
```

## Лимиты бесплатных сервисов

| Сервис | Лимит |
|---|---|
| Gemini 2.5 Flash Image | 500 изображений / день |
| Supabase | 500 МБ Storage, 2 ГБ DB |
| Vercel Hobby | 100 ГБ bandwidth, 100 serverless invocations/day |
| Anthropic API | Платный, ~$0.003 за анализ книги |

## Следующие шаги

- [ ] Авторизация пользователей (Supabase Auth)
- [ ] Библиотека книг (страница `/library`)
- [ ] Поддержка PDF (pdf-parse)
- [ ] Экспорт графа в PNG/SVG
- [ ] Поиск по персонажам
- [ ] Мобильная адаптация
