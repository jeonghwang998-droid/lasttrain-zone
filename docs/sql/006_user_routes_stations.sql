-- 등록한 경로에 지하철역 정보(역 id, 노선)를 함께 저장한다
-- 005_user_routes.sql 을 실행한 뒤 Supabase SQL Editor 에서 한 번 실행한다. 여러 번 실행해도 된다.

alter table public.user_routes
  add column if not exists from_station_id text,
  add column if not exists from_line       text,
  add column if not exists to_station_id   text,
  add column if not exists to_line         text;
