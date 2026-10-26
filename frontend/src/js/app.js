// 모든 페이지가 공통으로 쓰는 앱 껍데기: 하단 탭바, 서비스 워커 등록

// 프론트엔드 루트 주소 (이 파일은 src/js/ 에 있다). 페이지 깊이와 상관없이 링크를 만들기 위해 쓴다
const ROOT = new URL('../../', import.meta.url)

export function url(path) {
  return new URL(path, ROOT).href
}

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/>',
  group: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.9.8 3 2.7 3 5.6"/>',
  me: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/>',
}

const TABS = [
  { id: 'home', label: '홈', href: 'index.html' },
  { id: 'group', label: '우리 모임', href: 'html/join.html' },
  { id: 'me', label: '내 정보', href: 'html/profile.html' },
]

// <body data-tab="home|group|me"> 인 페이지에만 하단 탭바를 붙인다
function mountTabbar() {
  const active = document.body.dataset.tab
  if (!active) return
  const nav = document.createElement('nav')
  nav.className = 'tabbar'
  nav.setAttribute('aria-label', '주요 메뉴')
  nav.innerHTML = TABS.map(
    (t) =>
      `<a href="${url(t.href)}"${t.id === active ? ' aria-current="page"' : ''}>` +
      `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[t.id]}</svg>` +
      `<span>${t.label}</span></a>`,
  ).join('')
  document.body.append(nav)
}

// 오프라인과 홈 화면 설치(PWA)를 위한 서비스 워커. localhost 또는 https 에서만 동작한다
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register(url('sw.js'), { scope: ROOT.pathname }).catch(() => {
    /* 등록 실패해도 앱은 그대로 동작 */
  })
}

export function initApp() {
  mountTabbar()
  registerServiceWorker()
}
