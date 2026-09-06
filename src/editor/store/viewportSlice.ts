import type { StateCreator } from 'zustand'
import type { ViewportState } from '@/editor/types'
import type { EditorStoreState } from './editorStore'

export interface ViewportSlice {
  viewport: ViewportState
  setViewport: (viewport: ViewportState) => void
}

export const createViewportSlice: StateCreator<EditorStoreState, [], [], ViewportSlice> = (set) => ({
  viewport: { zoom: 1, panX: 0, panY: 0 },
  setViewport: (viewport) => set((state) => {
    if (!state.project || !state.activeSceneId) return { viewport }
    return {
      viewport,
      project: {
        ...state.project,
        document: {
          ...state.project.document,
          scenes: state.project.document.scenes.map((scene) =>
            scene.id === state.activeSceneId ? { ...scene, viewport } : scene,
          ),
        },
        updatedAt: new Date().toISOString(),
      },
    }
  }),
})
