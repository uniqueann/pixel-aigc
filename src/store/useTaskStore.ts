import { create } from 'zustand'
import type { GenerationTask } from '@/types'

interface TaskStoreState {
  tasks: Record<string, GenerationTask<unknown>>
  upsertTask: (task: GenerationTask<unknown>) => void
  removeTask: (taskId: string) => void
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  tasks: {},
  upsertTask: (task) =>
    set((state) => ({ tasks: { ...state.tasks, [task.id]: task } })),
  removeTask: (taskId) =>
    set((state) => {
      const next = { ...state.tasks }
      delete next[taskId]
      return { tasks: next }
    }),
}))
