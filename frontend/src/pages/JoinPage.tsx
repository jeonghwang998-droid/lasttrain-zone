export default function JoinPage() {
  return (
    <main className="page">
      <h1>초대 코드로 입장</h1>
      {/* TODO */}
      <ul>
        <li>6자리 코드 입력 → /api/rooms/join → /rooms/:id 로 이동</li>
        <li>URL ?code= 로 들어오면 자동 입력</li>
      </ul>
    </main>
  )
}
