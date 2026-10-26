export default function OnboardingPage() {
  return (
    <main className="page">
      <h1>시작하기</h1>
      {/* TODO */}
      <ul>
        <li>로그인 (Supabase Auth)</li>
        <li>집 위치 등록 (지도에서 선택 or 주소 검색)</li>
        <li>알림 권한 요청 + subscribePush</li>
        <li>iOS 면 홈 화면 추가 안내</li>
      </ul>
    </main>
  )
}
