// Supabase 클라이언트. 라이브러리는 CDN 에서 바로 불러온다 (npm/Vite 없이 Go Live 로도 동작)

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
