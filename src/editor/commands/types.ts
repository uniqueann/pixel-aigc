import type { Asset, EditorNode, PixelProject, SceneId } from '@/editor/types'

export interface EditorContext {
  getProject: () => PixelProject | null
  addNode: (sceneId: SceneId, node: EditorNode) => void
  removeNode: (sceneId: SceneId, nodeId: string) => void
  updateNode: (sceneId: SceneId, nodeId: string, changes: Partial<EditorNode>) => void
  registerAsset: (asset: Asset) => void
}

export type SerializedEditorCommand =
  | { type: 'add-node'; id: string; sceneId: SceneId; node: EditorNode }
  | { type: 'remove-node'; id: string; sceneId: SceneId; nodeId: string; removedNode?: EditorNode }
  | { type: 'update-node'; id: string; sceneId: SceneId; nodeId: string; changes: Partial<EditorNode>; previous?: EditorNode }
  | { type: 'insert-generated'; id: string; sceneId: SceneId; asset: Asset; node: EditorNode }
  | { type: 'resolve-generation'; id: string; sceneId: SceneId; placeholderNodeIds: string[]; outputs: Array<{ asset: Asset; node: EditorNode }> }

export interface EditorCommand {
  id: string
  execute(ctx: EditorContext): void
  undo(ctx: EditorContext): void
  serialize(): SerializedEditorCommand
}
