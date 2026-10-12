import { create } from 'zustand'
import type { GenerationTask } from '@/types'

interface TaskStoreState {
  owner: string | null
  resetOwner: (owner: string | null) => void
  tasks: Record<string, GenerationTask<unknown>>
  upsertTask: (task: GenerationTask<unknown>, owner?: string) => void
  removeTask: (taskId: string) => void
}

export const useTaskStore = create<TaskStoreState>((set) => ({
  owner: null,
  resetOwner: (owner) =>
    set((state) => (state.owner === owner ? state : { owner, tasks: {} })),
  tasks: {},
  upsertTask: (task, owner) =>
    set((state) =>
      owner && state.owner !== owner
        ? state
        : { tasks: { ...state.tasks, [task.id]: task } },
    ),
  removeTask: (taskId) =>
    set((state) => {
      const next = { ...state.tasks }
      delete next[taskId]
      return { tasks: next }
    }),
}))
