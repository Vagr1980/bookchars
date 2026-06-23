-- ============================================================
-- BookChars — схема базы данных
-- Запускать через: supabase db push
-- ============================================================

-- Расширения
create extension if not exists "uuid-ossp";

-- ─── Таблица книг ────────────────────────────────────────────────────────────

create table if not exists books (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid references auth.users(id) on delete cascade,
  title           text not null,
  author          text,
  language        text not null default 'ru' check (language in ('ru', 'en', 'other')),
  source_type     text not null default 'text' check (source_type in ('text', 'pdf', 'url')),
  text_preview    text not null default '',
  status          text not null default 'pending'
                  check (status in ('pending', 'analyzing', 'done', 'error')),
  error_message   text,
  characters_count integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─── Таблица персонажей ──────────────────────────────────────────────────────

create table if not exists characters (
  id              uuid primary key default uuid_generate_v4(),
  book_id         uuid not null references books(id) on delete cascade,
  name            text not null,
  role            text not null default 'other'
                  check (role in ('protagonist', 'antagonist', 'supporting', 'mentor', 'other')),
  role_label      text not null default '',
  appearance      text not null default '',
  description     text not null default '',
  avatar_url      text,
  avatar_prompt   text,
  color           text not null default '#7F77DD',
  initials        text not null default '',
  created_at      timestamptz not null default now()
);

-- ─── Таблица связей ──────────────────────────────────────────────────────────

create table if not exists relationships (
  id                  uuid primary key default uuid_generate_v4(),
  book_id             uuid not null references books(id) on delete cascade,
  from_character_id   uuid not null references characters(id) on delete cascade,
  to_character_id     uuid not null references characters(id) on delete cascade,
  type                text not null,
  description         text,
  created_at          timestamptz not null default now(),
  constraint no_self_rel check (from_character_id != to_character_id)
);

-- ─── Индексы ─────────────────────────────────────────────────────────────────

create index if not exists idx_books_user_id       on books(user_id);
create index if not exists idx_books_status        on books(status);
create index if not exists idx_characters_book_id  on characters(book_id);
create index if not exists idx_rels_book_id        on relationships(book_id);
create index if not exists idx_rels_from_char      on relationships(from_character_id);
create index if not exists idx_rels_to_char        on relationships(to_character_id);

-- ─── Автообновление updated_at ───────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists books_updated_at on books;
create trigger books_updated_at
  before update on books
  for each row execute function update_updated_at();

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table books         enable row level security;
alter table characters    enable row level security;
alter table relationships enable row level security;

-- Анонимные пользователи видят только свои книги (по user_id = null или совпадению)
-- Авторизованные — только свои

create policy "books_select" on books for select
  using (user_id = auth.uid() or user_id is null);

create policy "books_insert" on books for insert
  with check (user_id = auth.uid() or user_id is null);

create policy "books_update" on books for update
  using (user_id = auth.uid() or user_id is null);

create policy "books_delete" on books for delete
  using (user_id = auth.uid() or user_id is null);

create policy "characters_select" on characters for select
  using (exists (
    select 1 from books where books.id = characters.book_id
    and (books.user_id = auth.uid() or books.user_id is null)
  ));

create policy "characters_insert" on characters for insert
  with check (exists (
    select 1 from books where books.id = characters.book_id
    and (books.user_id = auth.uid() or books.user_id is null)
  ));

create policy "characters_update" on characters for update
  using (exists (
    select 1 from books where books.id = characters.book_id
    and (books.user_id = auth.uid() or books.user_id is null)
  ));

create policy "relationships_select" on relationships for select
  using (exists (
    select 1 from books where books.id = relationships.book_id
    and (books.user_id = auth.uid() or books.user_id is null)
  ));

create policy "relationships_insert" on relationships for insert
  with check (exists (
    select 1 from books where books.id = relationships.book_id
    and (books.user_id = auth.uid() or books.user_id is null)
  ));

-- ─── Хранилище аватаров ──────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_public_read" on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_insert" on storage.objects for insert
  with check (bucket_id = 'avatars');
