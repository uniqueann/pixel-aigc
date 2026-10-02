import type { StateCreator } from 'zustand'
import type { EditorCommand, EditorContext } from '@/editor/commands'
import type { EditorStoreState } from './editorStore'

export const MAX_PERSISTED_HISTORY = 40

export interface HistorySlice {
  undoStack: EditorCommand[]
  redoStack: EditorCommand[]
  executeCommand: (command: EditorCommand) => void
  undo: () => void
  redo: () => void
  clearHistory: () => void
  restoreHistory: (undo: EditorCommand[], redo: EditorCommand[]) => void
}

export const createHistorySlice: StateCreator<EditorStoreState, [], [], HistorySlice> = (set, get) => {
  const context = (): EditorContext => ({
    getProject: () => get().project,
    addNode: get().addNode,
    removeNode: get().removeNode,
    updateNode: get().updateNode,
    registerAsset: get().registerAsset,
  })

  return {
    undoStack: [],
    redoStack: [],
    executeCommand: (command) => {
      if (!get().project) return
      command.execute(context())
      set((state) => ({
        undoStack: [...state.undoStack, command].slice(-MAX_PERSISTED_HISTORY),
        redoStack: [],
      }))
    },
    undo: () => {
      const command = get().undoStack[get().undoStack.length - 1]
      if (!command) return
      command.undo(context())
      set((state) => ({
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, command],
      }))
    },
    redo: () => {
      const command = get().redoStack[get().redoStack.length - 1]
      if (!command) return
      command.execute(context())
      set((state) => ({
        undoStack: [...state.undoStack, command],
        redoStack: state.redoStack.slice(0, -1),
      }))
    },
    clearHistory: () => set({ undoStack: [], redoStack: [] }),
    restoreHistory: (undo, redo) => set({
      undoStack: undo.slice(-MAX_PERSISTED_HISTORY),
      redoStack: redo.slice(-MAX_PERSISTED_HISTORY),
    }),
  }
}
