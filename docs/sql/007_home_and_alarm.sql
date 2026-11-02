-- 집 주소(도착지)와 경로별 알람
-- 005, 006 을 실행한 뒤 Supabase SQL Editor 에서 한 번 실행한다. 여러 번 실행해도 된다.
-- (예전 user_homes 테이블은 건드리지 않는다. 집은 새 my_home 에 저장한다)

-- 1) 내 집: 사용자마다 한 줄
create table if not exists public.my_home (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  place_name    text not null default '' check (char_length(place_name) <= 60),
  address       text not null default '' check (char_length(address) <= 120),
  lat           double precision,
  lng           double precision,
  station_id    text,  -- 집에서 가까운 지하철역 (공공데이터 역 id)
  station_label text,  -- 화면에 보이는 이름 (예: 고잔역 (수인분당))
  station_line  text,
  updated_at    timestamptz not null default now()
);

alter table public.my_home enable row level security;

drop policy if exists "my_home_select" on public.my_home;
create policy "my_home_select" on public.my_home
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "my_home_insert" on public.my_home;
create policy "my_home_insert" on public.my_home
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "my_home_update" on public.my_home;
create policy "my_home_update" on public.my_home
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "my_home_delete" on public.my_home;
create policy "my_home_delete" on public.my_home
  for delete to authenticated using (user_id = auth.uid());

-- 2) 등록한 경로: 도착지가 '내 집'인지, 알람을 켰는지
alter table public.user_routes
  add column if not exists to_home   boolean not null default false,
  add column if not exists alarm_on  boolean not null default false;
