import type { EditorNode } from './node'
import type { SceneId } from './ids'

export interface ViewportState {
  zoom: number
  panX: number
  panY: number
}

export interface Scene {
  id: SceneId
  name: string
  width: number
  height: number
  background?: string
  nodes: EditorNode[]
  viewport: ViewportState
}

export interface PixelDocument {
  version: 1
  scenes: Scene[]
  activeSceneId: SceneId
}
