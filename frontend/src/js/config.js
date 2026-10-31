// 프론트엔드 설정. 빌드 도구 없이 Go Live 로 열어도 동작하도록 .env 대신 여기에 직접 적는다.
// anon 키는 브라우저에 공개되는 키라서 여기 있어도 된다 (데이터는 DB 의 RLS 정책이 지킨다).
// service_role 키는 절대 여기에 넣지 말 것.

export const SUPABASE_URL = 'https://jnoitxgcpncsfvuaqjls.supabase.co'
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impub2l0eGdjcG5jc2Z2dWFxamxzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNDQ1OTksImV4cCI6MjEwODgyMDU5OX0.t2rWMAoPdilkSFx1FVI0-sUzPNpvDADJezdoR9KYj2g'
