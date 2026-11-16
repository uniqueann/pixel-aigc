import type { Asset, EditorNode, ImageNode, NodeId, SceneId, VideoNode } from '@/editor/types'
import type { EditorCommand, EditorContext, SerializedEditorCommand } from './types'

function findNode(ctx: EditorContext, sceneId: SceneId, nodeId: NodeId) {
  return ctx.getProject()?.document.scenes
    .find((scene) => scene.id === sceneId)?.nodes
    .find((node) => node.id === nodeId)
}

abstract class BaseCommand implements EditorCommand {
  readonly id: string
  constructor(id?: string) { this.id = id ?? crypto.randomUUID() }
  abstract execute(ctx: EditorContext): void
  abstract undo(ctx: EditorContext): void
  abstract serialize(): SerializedEditorCommand
}

export class AddNodeCommand extends BaseCommand {
  constructor(private readonly sceneId: SceneId, private readonly node: EditorNode, id?: string) { super(id) }
  execute(ctx: EditorContext) { ctx.addNode(this.sceneId, this.node) }
  undo(ctx: EditorContext) { ctx.removeNode(this.sceneId, this.node.id) }
  serialize(): SerializedEditorCommand { return { type: 'add-node', id: this.id, sceneId: this.sceneId, node: this.node } }
}

export class RemoveNodeCommand extends BaseCommand {
  private removedNode?: EditorNode

  constructor(private readonly sceneId: SceneId, private readonly nodeId: NodeId, removedNode?: EditorNode, id?: string) {
    super(id)
    this.removedNode = removedNode
  }

  execute(ctx: EditorContext) {
    this.removedNode = findNode(ctx, this.sceneId, this.nodeId) ?? this.removedNode
    ctx.removeNode(this.sceneId, this.nodeId)
  }

  undo(ctx: EditorContext) {
    if (this.removedNode) ctx.addNode(this.sceneId, this.removedNode)
  }

  serialize(): SerializedEditorCommand {
    return { type: 'remove-node', id: this.id, sceneId: this.sceneId, nodeId: this.nodeId, removedNode: this.removedNode }
  }
}

export class UpdateNodeCommand extends BaseCommand {
  private previous?: EditorNode

  constructor(
    private readonly sceneId: SceneId,
    private readonly nodeId: NodeId,
    private readonly changes: Partial<EditorNode>,
    previous?: EditorNode,
    id?: string,
  ) {
    super(id)
    this.previous = previous
  }

  execute(ctx: EditorContext) {
    // 调用方可以预置 previous（无损拖动提交、历史恢复），此时保留它作为撤销快照。
    if (!this.previous) this.previous = findNode(ctx, this.sceneId, this.nodeId)
    ctx.updateNode(this.sceneId, this.nodeId, this.changes)
  }

  undo(ctx: EditorContext) {
    if (this.previous) ctx.updateNode(this.sceneId, this.nodeId, this.previous)
  }

  serialize(): SerializedEditorCommand {
    return { type: 'update-node', id: this.id, sceneId: this.sceneId, nodeId: this.nodeId, changes: this.changes, previous: this.previous }
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
    id?: string,
  ) { super(id) }

  execute(ctx: EditorContext) {
    ctx.registerAsset(this.asset)
    ctx.addNode(this.sceneId, this.node)
  }

  undo(ctx: EditorContext) {
    // Asset 是可复用资源，撤销画布插入时仍保留在 Registry 中。
    ctx.removeNode(this.sceneId, this.node.id)
  }

  serialize(): SerializedEditorCommand {
    return { type: 'insert-generated', id: this.id, sceneId: this.sceneId, asset: this.asset, node: this.node }
  }
}

export interface GeneratedMediaOutput {
  asset: Asset
  node: ImageNode | VideoNode
}

export class ResolveGenerationCommand extends BaseCommand {
  constructor(
    private readonly sceneId: SceneId,
    private readonly placeholderNodeIds: NodeId[],
    private readonly outputs: GeneratedMediaOutput[],
    id?: string,
  ) { super(id) }

  execute(ctx: EditorContext) {
    this.placeholderNodeIds.forEach((nodeId) => ctx.removeNode(this.sceneId, nodeId))
    this.outputs.forEach(({ asset, node }) => {
      ctx.registerAsset(asset)
      ctx.addNode(this.sceneId, node)
    })
  }

  undo(ctx: EditorContext) {
    // 生成资源保留在 Registry 中，撤销时按批次移除画布节点。
    this.outputs.forEach(({ node }) => ctx.removeNode(this.sceneId, node.id))
  }

  serialize(): SerializedEditorCommand {
    return { type: 'resolve-generation', id: this.id, sceneId: this.sceneId, placeholderNodeIds: this.placeholderNodeIds, outputs: this.outputs }
  }
}

/** 把多条命令合成一次可撤销的操作：顺序执行，逆序回滚。 */
export class CompositeCommand extends BaseCommand {
  constructor(
    private readonly sceneId: SceneId,
    private readonly commands: EditorCommand[],
    id?: string,
  ) { super(id) }

  execute(ctx: EditorContext) {
    for (const command of this.commands) command.execute(ctx)
  }

  undo(ctx: EditorContext) {
    for (const command of [...this.commands].reverse()) command.undo(ctx)
  }

  serialize(): SerializedEditorCommand {
    return { type: 'composite', id: this.id, sceneId: this.sceneId, commands: this.commands.map((command) => command.serialize()) }
  }
}

export function deserializeCommand(value: SerializedEditorCommand): EditorCommand {
  switch (value.type) {
    case 'add-node':
      return new AddNodeCommand(value.sceneId, value.node, value.id)
    case 'remove-node':
      return new RemoveNodeCommand(value.sceneId, value.nodeId, value.removedNode, value.id)
    case 'update-node':
      return new UpdateNodeCommand(value.sceneId, value.nodeId, value.changes, value.previous, value.id)
    case 'insert-generated':
      return new InsertGeneratedAssetCommand(value.sceneId, value.asset, value.node, value.id)
    case 'resolve-generation':
      return new ResolveGenerationCommand(value.sceneId, value.placeholderNodeIds, value.outputs as GeneratedMediaOutput[], value.id)
    case 'composite':
      return new CompositeCommand(value.sceneId, value.commands.map(deserializeCommand), value.id)
  }
}
