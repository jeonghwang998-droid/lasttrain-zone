import { useEffect, useState } from 'react'

/** 목표 시각까지 남은 초 (1초마다 갱신). 음수면 지남 */
export function useCountdown(target: Date | null): number | null {
  const [left, setLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!target) return
    const tick = () => setLeft(Math.floor((target.getTime() - Date.now()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [target])

  return left
}
