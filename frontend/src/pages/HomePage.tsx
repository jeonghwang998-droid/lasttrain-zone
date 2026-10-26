export default function HomePage() {
  return (
    <main className="page">
      <h1>내 막차</h1>
      {/* TODO */}
      <ul>
        <li>useGeolocation 으로 현재 위치 받기</li>
        <li>/api/plan 호출 → 일어나야 할 시각, 남은 시간 표시 (Countdown)</li>
        <li>/api/zone 호출 → ZoneMap 에 내 자기장 표시</li>
        <li>TaxiMeter, RouteCard 목록</li>
        <li>모임방 만들기 / 참여 버튼</li>
      </ul>
    </main>
  )
}
