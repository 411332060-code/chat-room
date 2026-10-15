-- Run once in the Supabase SQL editor. Safe to run again (it never drops data).
--
-- The browser is not trusted: identity, nickname and time are filled in here,
-- the client may only write `id` and `content`, and nobody can edit or delete.
-- Tables use the chat_ prefix so they do not clash with other projects in the same database.

-- Nicknames: one per anonymous identity ----------------------------------------

create table if not exists public.chat_profiles (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  nickname text not null
);

alter table public.chat_profiles enable row level security;
revoke all on public.chat_profiles from anon, authenticated;
grant select on public.chat_profiles to authenticated;

drop policy if exists "read own profile" on public.chat_profiles;
create policy "read own profile" on public.chat_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- chat_join(): called on entry; creates the nickname the first time ----------------

create or replace function public.chat_join()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  animals text[] := array['貓咪','水獺','企鵝','狐狸','柴犬','浣熊','無尾熊','刺蝟','海豚','兔子'];
  nick    text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  insert into public.chat_profiles (user_id, nickname)
  values (uid, '匿名' || animals[1 + floor(random() * array_length(animals, 1))::int]
               || ' ' || lpad(floor(random() * 1000)::int::text, 3, '0'))
  on conflict (user_id) do nothing;

  select p.nickname into nick from public.chat_profiles p where p.user_id = uid;
  return nick;
end;
$$;

revoke all on function public.chat_join() from public, anon;
grant execute on function public.chat_join() to authenticated;

-- Messages --------------------------------------------------------------------------

create table if not exists public.chat_messages (
  id         uuid primary key,                     -- made by the client, so a retry cannot duplicate
  author_id  uuid not null,
  nickname   text not null,
  content    text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_idx on public.chat_messages (created_at desc, id desc);
create index if not exists chat_messages_author_idx  on public.chat_messages (author_id, created_at desc);

alter table public.chat_messages enable row level security;
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to authenticated;
grant insert (id, content) on public.chat_messages to authenticated;   -- only these two columns

drop policy if exists "read all" on public.chat_messages;
create policy "read all" on public.chat_messages
  for select to authenticated using (true);

drop policy if exists "insert as self" on public.chat_messages;
create policy "insert as self" on public.chat_messages
  for insert to authenticated
  with check (author_id = (select auth.uid()));

-- Before every insert: stamp identity, clean the text, rate-limit ----------------------
-- The exception text is an error code; the client turns it into a friendly message.

create or replace function public.chat_stamp_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  nick   text;
  recent int;
  last_t timestamptz;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.nickname into nick from public.chat_profiles p where p.user_id = uid;
  if nick is null then
    raise exception 'NO_PROFILE';
  end if;

  new.author_id  := uid;
  new.nickname   := nick;
  new.created_at := clock_timestamp();

  -- tidy: unify newlines, drop invisible characters, squash blank lines, trim
  new.content := regexp_replace(new.content, '\r\n?', E'\n', 'g');
  new.content := regexp_replace(
    new.content,
    '[\u0001-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]',
    '', 'g');
  new.content := regexp_replace(new.content, '\n{3,}', E'\n\n', 'g');
  new.content := btrim(new.content, E' \t\n　 ');

  if char_length(new.content) = 0 then
    raise exception 'EMPTY';
  end if;
  if char_length(new.content) > 500 then
    raise exception 'TOO_LONG';
  end if;

  -- rate limit: at most 5 per 10 s, and at least 0.5 s apart.
  -- Lock per user first so parallel requests cannot slip past the count.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select count(*), max(m.created_at) into recent, last_t
  from public.chat_messages m
  where m.author_id = uid and m.created_at > new.created_at - interval '10 seconds';

  if recent >= 5 or (last_t is not null and new.created_at - last_t < interval '0.5 seconds') then
    raise exception 'RATE_LIMITED';
  end if;

  return new;
end;
$$;

revoke all on function public.chat_stamp_message() from public, anon, authenticated;

drop trigger if exists chat_stamp_message on public.chat_messages;
create trigger chat_stamp_message
  before insert on public.chat_messages
  for each row execute function public.chat_stamp_message();

-- Realtime: push new rows to connected browsers -----------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end;
$$;
