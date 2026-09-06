import type { Asset, EditorNode, NodeId, SceneId } from '@/editor/types'
import type { EditorCommand, EditorContext } from './types'

function findNode(ctx: EditorContext, sceneId: SceneId, nodeId: NodeId) {
  return ctx.getProject()?.document.scenes
    .find((scene) => scene.id === sceneId)?.nodes
    .find((node) => node.id === nodeId)
}

abstract class BaseCommand implements EditorCommand {
  readonly id = crypto.randomUUID()
  abstract execute(ctx: EditorContext): void
  abstract undo(ctx: EditorContext): void
}

export class AddNodeCommand extends BaseCommand {
  constructor(private readonly sceneId: SceneId, private readonly node: EditorNode) { super() }
  execute(ctx: EditorContext) { ctx.addNode(this.sceneId, this.node) }
  undo(ctx: EditorContext) { ctx.removeNode(this.sceneId, this.node.id) }
}

export class RemoveNodeCommand extends BaseCommand {
  private removedNode?: EditorNode

  constructor(private readonly sceneId: SceneId, private readonly nodeId: NodeId) { super() }

  execute(ctx: EditorContext) {
    this.removedNode = findNode(ctx, this.sceneId, this.nodeId) ?? this.removedNode
    ctx.removeNode(this.sceneId, this.nodeId)
  }

  undo(ctx: EditorContext) {
    if (this.removedNode) ctx.addNode(this.sceneId, this.removedNode)
  }
}

export class UpdateNodeCommand extends BaseCommand {
  private previous?: EditorNode

  constructor(
    private readonly sceneId: SceneId,
    private readonly nodeId: NodeId,
    private readonly changes: Partial<EditorNode>,
  ) { super() }

  execute(ctx: EditorContext) {
    this.previous = findNode(ctx, this.sceneId, this.nodeId) ?? this.previous
    ctx.updateNode(this.sceneId, this.nodeId, this.changes)
  }

  undo(ctx: EditorContext) {
    if (this.previous) ctx.updateNode(this.sceneId, this.nodeId, this.previous)
  }
}

export class MoveNodeCommand extends UpdateNodeCommand {
  constructor(sceneId: SceneId, nodeId: NodeId, position: { x: number; y: number }) {
    super(sceneId, nodeId, position)
  }
}

export class ResizeNodeCommand extends UpdateNodeCommand {
  constructor(sceneId: SceneId, nodeId: NodeId, size: { width: number; height: number }) {
    super(sceneId, nodeId, size)
  }
}

export class InsertGeneratedAssetCommand extends BaseCommand {
  constructor(
    private readonly sceneId: SceneId,
    private readonly asset: Asset,
    private readonly node: EditorNode,
  ) { super() }

  execute(ctx: EditorContext) {
    ctx.registerAsset(this.asset)
    ctx.addNode(this.sceneId, this.node)
  }

  undo(ctx: EditorContext) {
    // Asset 是可复用资源，撤销画布插入时仍保留在 Registry 中。
    ctx.removeNode(this.sceneId, this.node.id)
  }
}
