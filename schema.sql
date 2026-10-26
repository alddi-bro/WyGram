-- WyGram starter schema. Run this whole file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null default 'User',
  created_at timestamptz not null default now(),
  constraint username_format check (username is null or username ~ '^[a-z][a-z0-9_]{2,19}$')
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct','group','channel')),
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  direct_pair_key text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);

create table if not exists public.gift_catalog (
  id text primary key,
  name text not null,
  emoji text not null default '🎁',
  price_stars integer not null check (price_stars >= 0),
  active boolean not null default true
);
create table if not exists public.user_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stars bigint not null default 0 check (stars >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.gift_transfers (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id),
  receiver_id uuid not null references public.profiles(id),
  gift_id text not null references public.gift_catalog(id),
  stars_paid integer not null check (stars_paid >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.collectible_usernames (
  username text primary key check (username ~ '^[a-z][a-z0-9_]{2,19}$'),
  owner_id uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Create profile automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1), 'User'))
  on conflict (id) do nothing;
  insert into public.user_wallets(user_id, stars) values (new.id, 0) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_wygram on auth.users;
create trigger on_auth_user_created_wygram after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Atomic username claiming: unique constraint prevents two users taking the same name.
create or replace function public.claim_username(desired_username text)
returns text language plpgsql security definer set search_path = public
as $$
declare cleaned text := lower(regexp_replace(trim(desired_username), '^@', ''));
begin
  if auth.uid() is null then raise exception 'Нужно войти в аккаунт'; end if;
  if cleaned !~ '^[a-z][a-z0-9_]{2,19}$' then
    raise exception 'Ник: 3–20 символов, латиница, цифры и _';
  end if;
  update public.profiles set username = cleaned where id = auth.uid();
  if not found then raise exception 'Профиль не найден'; end if;
  return cleaned;
exception when unique_violation then
  raise exception 'Этот юзернейм уже занят';
end;
$$;

create or replace function public.is_conversation_member(cid uuid, uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.conversation_members cm where cm.conversation_id=cid and cm.user_id=uid);
$$;

create or replace function public.create_direct_chat(target_username text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare target_id uuid; current_id uuid := auth.uid(); low_id text; high_id text; pair_key text; conv_id uuid;
begin
  if current_id is null then raise exception 'Нужно войти в аккаунт'; end if;
  select id into target_id from public.profiles where username=lower(regexp_replace(trim(target_username), '^@', ''));
  if target_id is null then raise exception 'Пользователь не найден'; end if;
  if target_id=current_id then raise exception 'Нельзя создать чат с самим собой'; end if;
  low_id := least(current_id::text,target_id::text); high_id := greatest(current_id::text,target_id::text);
  pair_key := low_id || ':' || high_id;
  select id into conv_id from public.conversations where direct_pair_key=pair_key;
  if conv_id is null then
    insert into public.conversations(kind,created_by,direct_pair_key) values ('direct',current_id,pair_key)
    on conflict (direct_pair_key) do update set direct_pair_key=excluded.direct_pair_key
    returning id into conv_id;
  end if;
  insert into public.conversation_members(conversation_id,user_id,role) values (conv_id,current_id,'member') on conflict do nothing;
  insert into public.conversation_members(conversation_id,user_id,role) values (conv_id,target_id,'member') on conflict do nothing;
  return conv_id;
end;
$$;

create or replace function public.create_group_or_channel(conversation_title text, conversation_kind text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Нужно войти в аккаунт'; end if;
  if conversation_kind not in ('group','channel') then raise exception 'Неверный тип'; end if;
  if length(trim(conversation_title)) < 2 or length(trim(conversation_title)) > 80 then raise exception 'Название: 2–80 символов'; end if;
  insert into public.conversations(kind,title,created_by) values (conversation_kind,trim(conversation_title),auth.uid()) returning id into new_id;
  insert into public.conversation_members(conversation_id,user_id,role) values (new_id,auth.uid(),'owner');
  return new_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.gift_catalog enable row level security;
alter table public.user_wallets enable row level security;
alter table public.gift_transfers enable row level security;
alter table public.collectible_usernames enable row level security;

drop policy if exists "Profiles readable by signed-in users" on public.profiles;
create policy "Profiles readable by signed-in users" on public.profiles for select to authenticated using (true);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

drop policy if exists "Members can read conversations" on public.conversations;
create policy "Members can read conversations" on public.conversations for select to authenticated using (public.is_conversation_member(id));
drop policy if exists "Members can read membership" on public.conversation_members;
create policy "Members can read membership" on public.conversation_members for select to authenticated using (public.is_conversation_member(conversation_id));
drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages" on public.messages for select to authenticated using (public.is_conversation_member(conversation_id));
drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages" on public.messages for insert to authenticated with check (sender_id=auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Gift catalog visible to signed-in users" on public.gift_catalog;
create policy "Gift catalog visible to signed-in users" on public.gift_catalog for select to authenticated using (active=true);
drop policy if exists "Users read own wallet" on public.user_wallets;
create policy "Users read own wallet" on public.user_wallets for select to authenticated using (user_id=auth.uid());
drop policy if exists "Users read own gift transfers" on public.gift_transfers;
create policy "Users read own gift transfers" on public.gift_transfers for select to authenticated using (sender_id=auth.uid() or receiver_id=auth.uid());
drop policy if exists "Collectible usernames visible" on public.collectible_usernames;
create policy "Collectible usernames visible" on public.collectible_usernames for select to authenticated using (true);

-- Allow Realtime subscriptions for messages.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

grant execute on function public.claim_username(text) to authenticated;
grant execute on function public.create_direct_chat(text) to authenticated;
grant execute on function public.create_group_or_channel(text,text) to authenticated;
grant execute on function public.is_conversation_member(uuid,uuid) to authenticated;
grant select on public.profiles, public.conversations, public.conversation_members, public.messages, public.gift_catalog, public.user_wallets, public.gift_transfers, public.collectible_usernames to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant insert on public.messages to authenticated;
