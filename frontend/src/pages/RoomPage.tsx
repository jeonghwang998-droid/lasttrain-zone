export default function RoomPage() {
  return (
    <main className="page">
      <h1>모임방</h1>
      {/* TODO */}
      <ul>
        <li>useParams 로 roomId 받기</li>
        <li>useRoomRealtime 으로 멤버 순위 (MemberList)</li>
        <li>/api/rooms/:id/zone 교집합 → HexOverlay</li>
        <li>다 같이 일어나기 콜 수신 시 CallBanner</li>
        <li>초대 코드 공유 버튼</li>
      </ul>
    </main>
  )
}
