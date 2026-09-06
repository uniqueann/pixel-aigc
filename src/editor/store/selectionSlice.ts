import type { StateCreator } from 'zustand'
import type { NodeId } from '@/editor/types'
import type { EditorStoreState } from './editorStore'

export interface SelectionSlice {
  selectedNodeIds: NodeId[]
  selectNodes: (nodeIds: NodeId[]) => void
  clearSelection: () => void
}

export const createSelectionSlice: StateCreator<EditorStoreState, [], [], SelectionSlice> = (set) => ({
  selectedNodeIds: [],
  selectNodes: (selectedNodeIds) => set({ selectedNodeIds: [...new Set(selectedNodeIds)] }),
  clearSelection: () => set({ selectedNodeIds: [] }),
})
