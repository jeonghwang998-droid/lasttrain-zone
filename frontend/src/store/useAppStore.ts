import { create } from 'zustand'
import type { PlanResponse, ZoneResponse } from '../types'

interface AppState {
  bufferMin: number
  walkSpeed: number          // m/분, 기본 75
  plan: PlanResponse | null
  zone: ZoneResponse | null
  setBufferMin: (v: number) => void
  setPlan: (p: PlanResponse | null) => void
  setZone: (z: ZoneResponse | null) => void
}

export const useAppStore = create<AppState>((set) => ({
  bufferMin: 5,
  walkSpeed: 75,
  plan: null,
  zone: null,
  setBufferMin: (v) => set({ bufferMin: v }),
  setPlan: (p) => set({ plan: p }),
  setZone: (z) => set({ zone: z }),
}))
