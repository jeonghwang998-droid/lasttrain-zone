-- 모임이 사라지지 않게 / 안심 귀가 체크 / 모임마다 내 도착지와 알람
-- 007 을 실행한 뒤 Supabase SQL Editor 에서 한 번 실행한다. 여러 번 실행해도 된다.

-- 1) 모임 만료 없애기: 처음 설계는 '만든 뒤 12시간'이 지나면 모임이 사라졌다.
--    새로 만드는 모임은 만료 시각을 무한대로 두고, 이미 만료된 모임도 되살린다
create or replace function public.rooms_never_expire() returns trigger
language plpgsql as $$
begin
  new.expires_at := 'infinity';
  return new;
end $$;

drop trigger if exists rooms_never_expire on public.rooms;
create trigger rooms_never_expire
  before insert or update of expires_at on public.rooms
  for each row execute function public.rooms_never_expire();

update public.rooms set expires_at = 'infinity' where status = 'active';

-- 2) 안심 귀가 체크: 집에 도착해서 '귀가 완료'를 누른 시각 (status = 'arrived' 와 함께 쓴다)
alter table public.room_members add column if not exists arrived_at timestamptz;

-- 3) 모임마다 내 도착지와 알람. 집 위치가 드러날 수 있어서 나만 볼 수 있다
--    (모임에는 출발 시각 room_members.leave_at 과 귀가 여부만 공유된다)
create table if not exists public.room_my_settings (
  room_id    uuid        not null references public.rooms (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  use_home   boolean     not null default true,  -- 도착지가 내 집(my_home)인지
  dest_station_id text,                           -- 집이 아니면 내릴 역 (공공데이터 역 id)
  dest_label text,
  dest_lat   double precision,
  dest_lng   double precision,
  alarm_on   boolean     not null default false, -- 다 같이 일어날 시각 알람
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_my_settings enable row level security;

drop policy if exists "room_my_settings_select" on public.room_my_settings;
create policy "room_my_settings_select" on public.room_my_settings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "room_my_settings_insert" on public.room_my_settings;
create policy "room_my_settings_insert" on public.room_my_settings
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.room_members m where m.room_id = room_my_settings.room_id and m.user_id = auth.uid())
  );

drop policy if exists "room_my_settings_update" on public.room_my_settings;
create policy "room_my_settings_update" on public.room_my_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "room_my_settings_delete" on public.room_my_settings;
create policy "room_my_settings_delete" on public.room_my_settings
  for delete to authenticated using (user_id = auth.uid());
