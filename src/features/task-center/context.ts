import { createContext, useContext } from 'react'
import type {
  TaskCenterSummary,
  TaskCenterSidebar,
  TaskTool,
  TaskHistoryState,
} from '@shared/task-center'
import type { TaskActor } from './client'
import type { TaskReceipt } from './receipts'

export interface TaskCenterContextValue {
  actor: TaskActor
  sidebar?: TaskCenterSidebar
  loading: boolean
  error: unknown
  receipts: TaskReceipt[]
  open: boolean
  selected: TaskCenterSummary | null
  tool?: TaskTool
  state: TaskHistoryState
  show: (task?: TaskCenterSummary, tool?: TaskTool) => void
  close: () => void
  filter: (tool: TaskTool | undefined, state: TaskHistoryState) => void
  refresh: () => void
  forget: (receipt: TaskReceipt) => void
  credits: () => void
}
export const TaskCenterContext = createContext<TaskCenterContextValue | null>(
  null,
)
export const useTaskCenter = () => useContext(TaskCenterContext)
