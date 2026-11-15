-- 지연 예측(분위수 회귀) + 막차 확률 ML
-- Supabase 대시보드 > SQL Editor 에서 실행한다. (docs/sql/004~009 다음)
--
-- 만드는 것
--   1) app_config 정책값 (읽기는 이미 있는 config_value / config_int / config_real 함수로)
--   2) train_timetable : KRIC 역 시간표 (backend/data/kric/timetable_*.json 을 올린다)
--   3) train_arrivals  : 실시간 도착정보 원본 (열차가 실제로 역에 도착한 시각)
--   4) train_delays    : 위 둘을 맞춘 뷰 → 지연(분), 시간대, 요일
--   5) ml_models       : 학습한 모델 기록 (활성 모델은 하나만) + 활성화 함수
-- 모두 백엔드 전용이다: RLS 를 켜고 정책을 두지 않으며 anon/authenticated 권한을 회수한다.
-- 백엔드는 service_role 키로 접근한다 (.env SUPABASE_SERVICE_ROLE_KEY).
--
-- 이번에 넣지 않은 것: 강수량, 다음 날 휴일 (테이블과 데이터 출처가 정해지면 뷰에 더한다)


-- =========================================================
-- 1. 정책값 (값만 바꾸면 코드 수정 없이 반영된다. 이미 있는 키는 덮어쓰지 않는다)
-- =========================================================
INSERT INTO public.app_config (key, value, description) VALUES
  ('ml.quantiles',                 '[0.5, 0.7, 0.8, 0.9, 0.95]'::jsonb,
   '지연 예측에서 학습할 분위수 목록 (지연 분포를 이 지점들로 나눠 예측)'),
  ('ml.min_samples',               '30'::jsonb,
   '역 단위 예측에 필요한 최소 기록 수 (모자라면 노선 단위, 그것도 모자라면 데이터 부족)'),
  ('ml.test_days',                 '14'::jsonb,
   '학습 데이터 맨 마지막에서 시험용으로 떼어 두는 일수 (날짜 기준 분할)'),
  ('ml.delay_valid_range',         '{"min": -5, "max": 30}'::jsonb,
   '학습에 쓰는 지연(분) 범위. 벗어나면 매칭 오류나 운행 중단으로 보고 뺀다'),
  ('probability.grade_thresholds', '{"safe": 0.9, "caution": 0.7}'::jsonb,
   '막차 확률 등급 기준: safe 이상 안전, caution 이상 주의, 그 아래 위험')
ON CONFLICT (key) DO NOTHING;


-- 설정값 읽기는 서버에 이미 있는 함수를 그대로 쓴다 (새로 만들지 않는다)
--   config_value(k text) → jsonb, config_int(k text) → integer, config_real(k text) → 실수
--   키가 없으면 '설정값이 없어요: 키' 오류를 낸다. 백엔드는 /rest/v1/rpc/config_value 에 {"k": "..."} 로 부른다


-- =========================================================
-- 2. 역 시간표 (KRIC). 같은 역·같은 열차는 한 줄 (한 열차가 같은 역을 두 번 지나면 처음 것만 올린다)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.train_timetable (
  day_code     text    NOT NULL,  -- KRIC 요일 코드: '8' 평일, '9' 토·일·휴일
  station_key  text    NOT NULL,  -- KRIC 역 키 '운영기관|노선코드|역코드' (예: 'KR|1|100-3')
  tago_id      text    NOT NULL,  -- 앱이 쓰는 공공데이터 역 id (MTR + 운영기관 + 노선코드 + 역코드)
  line_name    text    NOT NULL,  -- 노선 이름 (예: '수도권 1호선')
  station_name text    NOT NULL,
  train_no     text    NOT NULL,  -- KRIC 열차번호 (예: 'K35')
  arr_min      integer,           -- 도착 예정 (서비스 날 0시 기준 분, 자정 넘으면 1440 이상)
  dep_min      integer,           -- 출발 예정 (같은 기준)
  PRIMARY KEY (day_code, station_key, train_no)
);


-- =========================================================
-- 3. 실시간 도착정보 원본. 수집기가 역과 열차번호를 시간표 형식(station_key, train_no)으로 맞춰서 넣는다
--    (원본 API 의 값은 raw_* 에 그대로 남긴다. 같은 열차의 같은 도착은 한 번만)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.train_arrivals (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_date   date        NOT NULL,  -- 운행일 (새벽 5시 전 도착은 전날 운행)
  train_no       text        NOT NULL,  -- 시간표와 같은 형식의 열차번호
  station_key    text        NOT NULL,  -- 시간표와 같은 형식의 역 키
  direction      text,                  -- 상행/하행, 내선/외선 (원본 그대로)
  arrived_at     timestamptz NOT NULL,  -- 실제 도착 시각
  source         text        NOT NULL,  -- 출처 (예: 'seoul_realtime')
  raw_train_no   text,                  -- 원본 열차번호
  raw_station_id text,                  -- 원본 역 id
  collected_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_date, train_no, station_key)
);
CREATE INDEX IF NOT EXISTS train_arrivals_date_idx ON public.train_arrivals (service_date);


-- =========================================================
-- 4. 지연 뷰: 실제 도착 − 시간표 도착 (같은 열차번호, 같은 역, 같은 운행일의 요일 시간표)
--    토·일은 휴일 시간표('9'), 나머지는 평일('8'). 공휴일은 아직 구분하지 않는다 (평일로 잡힘)
--    지연이 ml.delay_valid_range 밖이면 뺀다
-- =========================================================
CREATE OR REPLACE VIEW public.train_delays WITH (security_invoker = true) AS
WITH m AS (
  SELECT
    a.id                       AS arrival_id,
    a.service_date,
    a.train_no,
    a.station_key,
    a.direction,
    t.tago_id,
    t.line_name,
    t.station_name,
    COALESCE(t.arr_min, t.dep_min) AS scheduled_min,
    EXTRACT(EPOCH FROM (a.arrived_at - (a.service_date::timestamp AT TIME ZONE 'Asia/Seoul'))) / 60.0 AS actual_min
  FROM public.train_arrivals a
  JOIN public.train_timetable t
    ON t.day_code    = CASE WHEN EXTRACT(ISODOW FROM a.service_date) >= 6 THEN '9' ELSE '8' END
   AND t.station_key = a.station_key
   AND t.train_no    = a.train_no
)
SELECT
  arrival_id,
  service_date,
  train_no,
  station_key,
  tago_id,
  line_name,
  station_name,
  direction,
  scheduled_min,
  ROUND((actual_min - scheduled_min)::numeric, 1)::double precision AS delay_min,
  (scheduled_min / 60)::integer                                     AS hour,     -- 24, 25 는 자정 넘은 0시, 1시
  (EXTRACT(ISODOW FROM service_date)::integer - 1)                  AS weekday   -- 0=월 … 6=일 (운행일 기준)
FROM m
WHERE scheduled_min IS NOT NULL
  AND actual_min - scheduled_min BETWEEN (public.config_value('ml.delay_valid_range') ->> 'min')::double precision
                                     AND (public.config_value('ml.delay_valid_range') ->> 'max')::double precision;


-- =========================================================
-- 5. 학습한 모델 기록. 활성 모델은 하나만 (부분 유니크 인덱스)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.ml_models (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version     text        NOT NULL UNIQUE,      -- 예: '20261112-153000'
  trained_at  timestamptz NOT NULL DEFAULT now(),
  data_source text        NOT NULL CHECK (data_source IN ('fake', 'db')),  -- 가짜 데이터로 학습했는지
  quantiles   jsonb       NOT NULL,             -- 학습한 분위수 목록
  features    jsonb       NOT NULL,             -- 특징 이름 목록 (예측 때 같은 순서로 맞춘다)
  metrics     jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- 적중률, 핀볼 손실, Brier 점수 등
  file_path   text        NOT NULL,             -- 저장한 모델 파일 (backend 기준 상대 경로)
  is_active   boolean     NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS ml_models_one_active ON public.ml_models (is_active) WHERE is_active;

-- 모델 활성화: 기존 활성 모델을 끄고 이 버전을 켠다 (한 번에 처리해서 활성 모델이 둘이 되거나 0개인 순간이 없다)
CREATE OR REPLACE FUNCTION public.activate_ml_model(p_version text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ml_models WHERE version = p_version) THEN
    RAISE EXCEPTION '모델이 없어요: %', p_version;
  END IF;
  UPDATE ml_models SET is_active = false WHERE is_active AND version <> p_version;
  UPDATE ml_models SET is_active = true  WHERE version = p_version;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.activate_ml_model(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.activate_ml_model(text) TO service_role;


-- =========================================================
-- 6. 백엔드 전용: RLS 켜고(정책 없음 = 아무도 못 읽음, service_role 은 RLS 를 건너뛴다) 권한 회수
-- =========================================================
ALTER TABLE public.train_timetable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.train_arrivals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.train_timetable FROM anon, authenticated;
REVOKE ALL ON public.train_arrivals  FROM anon, authenticated;
REVOKE ALL ON public.ml_models       FROM anon, authenticated;
REVOKE ALL ON public.train_delays    FROM anon, authenticated;
