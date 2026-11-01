// Flask 백엔드 호출: Supabase 로그인 토큰(JWT)을 자동으로 붙인다
// 서버가 한국어로 보낸 안내(error)만 화면에 보여 주고, 그 밖의 원문은 노출하지 않는다

import { supabase } from './supabase.js'
import { API_BASE_URL } from './config.js'

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function api(path, init = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session && data.session.access_token

  let res
  try {
    res = await fetch(API_BASE_URL + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch (e) {
    console.error('[api]', e)
    throw new ApiError(0, '서버에 연결하지 못했어요. 서버가 켜져 있는지 확인해 주세요.')
  }

  let body = null
  try {
    body = await res.json()
  } catch (e) {
    /* JSON 이 아닌 응답 */
  }
  if (!res.ok) {
    console.error('[api]', res.status, body)
    const msg = body && typeof body.error === 'string' && /[가-힣]/.test(body.error) ? body.error : '서버 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'
    throw new ApiError(res.status, msg)
  }
  return body
}

// 로그인한 내가 누구인지 서버가 알아보고 프로필을 돌려준다 { user_id, nickname, buffer_min, walk_speed }
export const getMe = () => api('/api/me')
