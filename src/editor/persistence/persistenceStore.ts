import { create } from 'zustand'
import { useEditorStore } from '@/editor/store'
import { defaultDrafts, type CanvasDrafts, type GenerationRecovery } from './types'

interface PersistenceState {
  cloud?: import('./types').ProjectSnapshot['cloud']
  phase: 'idle' | 'loading' | 'ready' | 'error'
  writable: boolean
  status: 'saved' | 'dirty' | 'saving' | 'error'
  error?: string
  raw?: unknown
  epoch: number
  drafts: CanvasDrafts
  recoveries: Record<string, GenerationRecovery>
  setDrafts: (drafts: CanvasDrafts) => void
  setRecovery: (record: GenerationRecovery) => void
}

export const usePersistenceStore = create<PersistenceState>((set) => ({
  phase: 'idle',
  writable: true,
  status: 'saved',
  epoch: 0,
  drafts: defaultDrafts(),
  recoveries: {},
  setDrafts: (drafts) => set({ drafts }),
  setRecovery: (record) => set((state) => ({ recoveries: { ...state.recoveries, [record.request.requestId]: record } })),
}))

export function recoveryForTask(taskId: string) {
  return Object.values(usePersistenceStore.getState().recoveries).find((record) => record.backendTaskId === taskId && record.projectId === useEditorStore.getState().project?.id)
}
