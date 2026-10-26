-- 막차 자기장 초기 스키마
-- Supabase 대시보드 > SQL Editor 에서 실행

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- 테이블
-- ---------------------------------------------------------------

-- 공개 프로필: 같은 방 멤버끼리 닉네임 조회 가능
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null default '',
  buffer_min  int  not null default 5 check (buffer_min between 0 and 30),
  created_at  timestamptz not null default now()
);

-- 집 위치: 본인만 조회 (다른 멤버에게 절대 노출 금지)
create table public.user_homes (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  label       text not null default '',
  lat         double precision not null,
  lng         double precision not null,
  station_id  text,
  updated_at  timestamptz not null default now()
);

create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (char_length(code) = 6),
  host_id     uuid not null references public.profiles(id) on delete cascade,
  place_label text not null default '',
  place_lat   double precision not null,
  place_lng   double precision not null,
  status      text not null default 'active' check (status in ('active', 'closed')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '12 hours'
);

create table public.room_members (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  leave_at    timestamptz,
  status      text not null default 'staying' check (status in ('staying', 'leaving', 'arrived')),
  updated_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on public.room_members(user_id);

create table public.walk_trips (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  distance_m  int not null check (distance_m > 0),
  minutes     real not null check (minutes > 0),
  created_at  timestamptz not null default now()
);

create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 헬퍼 함수 (RLS 안에서 room_members 를 다시 조회할 때 무한 재귀 방지)
-- ---------------------------------------------------------------
create or replace function public.is_room_member(rid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from room_members where room_id = rid and user_id = auth.uid()
  );
$$;

create or replace function public.shares_room_with(other uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from room_members me
    join room_members them on them.room_id = me.room_id
    where me.user_id = auth.uid() and them.user_id = other
  );
$$;

-- ---------------------------------------------------------------
-- RLS
-- 방 생성/참여(insert)는 백엔드가 service role 로 처리 → 클라이언트 insert 정책 없음
-- ---------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.user_homes         enable row level security;
alter table public.rooms              enable row level security;
alter table public.room_members       enable row level security;
alter table public.walk_trips         enable row level security;
alter table public.push_subscriptions enable row level security;

create policy profiles_read on public.profiles
  for select using (id = auth.uid() or public.shares_room_with(id));
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy homes_self on public.user_homes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy rooms_read_member on public.rooms
  for select using (host_id = auth.uid() or public.is_room_member(id));
create policy rooms_update_host on public.rooms
  for update using (host_id = auth.uid()) with check (host_id = auth.uid());

create policy members_read_same_room on public.room_members
  for select using (public.is_room_member(room_id));
create policy members_update_self on public.room_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy walk_self on public.walk_trips
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_self on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 가입 시 프로필 자동 생성
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- Realtime: 멤버 상태 변경을 같은 방 멤버에게 전파
-- ---------------------------------------------------------------
alter publication supabase_realtime add table public.room_members;
