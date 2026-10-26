import type { Plan } from '../types'

type Props = { plan: Plan; recommended?: boolean }

// TODO
  //  - 구간별 출발 시각, 환승, AI 예상 지연
  //  - 막차 확률 (예: 92%)
export default function RouteCard(_props: Props) {
  return <div>RouteCard (TODO)</div>
}
