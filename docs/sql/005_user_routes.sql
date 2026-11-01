-- 내가 등록한 막차 경로 (어디에서 어디까지)
-- Supabase 대시보드 > SQL Editor 에서 한 번 실행한다. 여러 번 실행해도 된다.

create table if not exists public.user_routes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  label      text        not null default '' check (char_length(label) <= 20), -- 사용자가 붙이는 이름 (선택)
  from_name  text        not null check (char_length(from_name) between 1 and 40),
  from_lat   double precision, -- 자동완성으로 고른 경우에만 있다
  from_lng   double precision,
  to_name    text        not null check (char_length(to_name) between 1 and 40),
  to_lat     double precision,
  to_lng     double precision,
  created_at timestamptz not null default now()
);

create index if not exists user_routes_user_idx on public.user_routes (user_id, created_at);

alter table public.user_routes enable row level security;

-- 내 경로만 보고, 만들고, 고치고, 지운다 (집 같은 위치 정보라 다른 사람에게는 보이지 않는다)
drop policy if exists "user_routes_select" on public.user_routes;
create policy "user_routes_select" on public.user_routes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "user_routes_insert" on public.user_routes;
create policy "user_routes_insert" on public.user_routes
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_routes_update" on public.user_routes;
create policy "user_routes_update" on public.user_routes
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "user_routes_delete" on public.user_routes;
create policy "user_routes_delete" on public.user_routes
  for delete to authenticated using (user_id = auth.uid());
