// 위치 기반 서비스: 권한 상태 확인과 현재 위치 가져오기
// 위치는 서버에 저장하지 않는다. 지도와 근처 역 찾기에 쓰는 동안만 이 기기에 있다
// 브라우저는 https 나 localhost(127.0.0.1) 에서만 위치를 준다

export const geoSupported = () => 'geolocation' in navigator

// 'granted'(켜짐) | 'prompt'(아직 안 물어봄) | 'denied'(꺼짐) | 'unsupported'
export async function permissionState() {
  if (!geoSupported()) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    return status.state
  } catch (e) {
    return 'prompt' // 권한 조회를 못 하는 브라우저(사파리 등)는 물어보기 전으로 본다
  }
}

// 권한이 바뀌면(설정에서 켜고 끄면) callback(state) 를 부른다
export async function onPermissionChange(callback) {
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' })
    status.addEventListener('change', () => callback(status.state))
  } catch (e) {
    /* 지원하지 않으면 무시 */
  }
}

const ERRORS = {
  1: '위치 권한이 꺼져 있어요. 주소창 옆 자물쇠에서 위치를 허용해 주세요.',
  2: '현재 위치를 찾지 못했어요. 잠시 후 다시 시도해 주세요.',
  3: '위치를 찾는 데 시간이 오래 걸려요. 다시 시도해 주세요.',
}

// 현재 위치. 처음 부르면 브라우저가 허용 여부를 물어본다. 반환: { lat, lng, accuracy(m) }
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!geoSupported()) return reject(new Error('이 브라우저는 위치 기능을 지원하지 않아요.'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(ERRORS[err.code] || ERRORS[2])),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  })
}
