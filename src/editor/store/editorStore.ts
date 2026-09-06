import { create } from 'zustand'
import { createHistorySlice, type HistorySlice } from './historySlice'
import { createProjectSlice, type ProjectSlice } from './projectSlice'
import { createSelectionSlice, type SelectionSlice } from './selectionSlice'
import { createViewportSlice, type ViewportSlice } from './viewportSlice'

export type EditorStoreState = ProjectSlice & SelectionSlice & ViewportSlice & HistorySlice

export const useEditorStore = create<EditorStoreState>()((...args) => ({
  ...createProjectSlice(...args),
  ...createSelectionSlice(...args),
  ...createViewportSlice(...args),
  ...createHistorySlice(...args),
}))
