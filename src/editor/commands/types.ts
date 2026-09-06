import type { Asset, EditorNode, PixelProject, SceneId } from '@/editor/types'

export interface EditorContext {
  getProject: () => PixelProject | null
  addNode: (sceneId: SceneId, node: EditorNode) => void
  removeNode: (sceneId: SceneId, nodeId: string) => void
  updateNode: (sceneId: SceneId, nodeId: string, changes: Partial<EditorNode>) => void
  registerAsset: (asset: Asset) => void
}

export interface EditorCommand {
  id: string
  execute(ctx: EditorContext): void
  undo(ctx: EditorContext): void
}
