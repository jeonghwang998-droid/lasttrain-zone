// 프론트엔드 설정. 빌드 도구 없이 Go Live 로 열어도 동작하도록 .env 대신 여기에 직접 적는다.
// anon 키는 브라우저에 공개되는 키라서 여기 있어도 된다 (데이터는 DB 의 RLS 정책이 지킨다).
// service_role 키는 절대 여기에 넣지 말 것.

export const SUPABASE_URL = 'https://jnoitxgcpncsfvuaqjls.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impub2l0eGdjcG5jc2Z2dWFxamxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNDQ1OTksImV4cCI6MjEwODgyMDU5OX0.t2rWMAoPdilkSFx1FVI0-sUzPNpvDADJezdoR9KYj2g'

// Flask 백엔드 주소. 로컬에서는 backend/wsgi.py 가 5000 번에서 돈다. 배포하면 그 주소로 바꾼다
// Flask 가 화면까지 내주는 주소(5000 번)로 열었으면 같은 주소로 부른다
export const API_BASE_URL = location.port === '5000' ? '' : 'http://localhost:5000'

// 카카오 JavaScript 키 (developers.kakao.com > 앱 키). 장소 검색 자동완성에 쓴다.
// 브라우저에 공개되는 키이고 등록한 도메인에서만 동작한다. 비워 두면 자동완성만 꺼진다
export const KAKAO_JS_KEY = 'aac527eabec3aff77c3deb0b913204b9'
