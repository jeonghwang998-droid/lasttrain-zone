import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './pages/HomePage'
import RoomPage from './pages/RoomPage'
import JoinPage from './pages/JoinPage'
import OnboardingPage from './pages/OnboardingPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  // TODO: 로그인 안 했거나 집 위치가 없으면 /onboarding 으로 보내기
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/rooms/:roomId" element={<RoomPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
