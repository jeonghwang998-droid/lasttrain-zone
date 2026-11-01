-- 모임(채널) 안에서 멤버가 입력하는 막차 (지하철 또는 버스)
-- Supabase 대시보드 > SQL Editor 에서 한 번 실행한다. 여러 번 실행해도 된다.
-- 가정: public.rooms(id), public.room_members(room_id, user_id) 가 이미 있다.

create table if not exists public.room_last_trains (
  room_id    uuid        not null references public.rooms (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  mode       text        not null check (mode in ('subway', 'bus')),
  line_label text        not null default '' check (char_length(line_label) <= 40),
  last_time  time        not null, -- 막차 시각 (시:분). 날짜는 오늘 밤으로 본다
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_last_trains enable row level security;

-- 같은 모임에 들어 있는 사람만 서로의 막차를 볼 수 있다
drop policy if exists "room_last_trains_select" on public.room_last_trains;
create policy "room_last_trains_select" on public.room_last_trains
  for select to authenticated
  using (exists (
    select 1 from public.room_members m
    where m.room_id = room_last_trains.room_id and m.user_id = auth.uid()
  ));

-- 내 막차만, 내가 들어간 모임에만 쓸 수 있다
drop policy if exists "room_last_trains_insert" on public.room_last_trains;
create policy "room_last_trains_insert" on public.room_last_trains
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.room_members m
      where m.room_id = room_last_trains.room_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "room_last_trains_update" on public.room_last_trains;
create policy "room_last_trains_update" on public.room_last_trains
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "room_last_trains_delete" on public.room_last_trains;
create policy "room_last_trains_delete" on public.room_last_trains
  for delete to authenticated
  using (user_id = auth.uid());

-- 실시간으로 멤버들의 화면에 바로 반영되게 한다 (이미 들어 있으면 오류가 나도 무시해도 된다)
alter publication supabase_realtime add table public.room_last_trains;
