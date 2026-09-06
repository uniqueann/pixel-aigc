import type { AssetId, GenerationId, NodeId } from './ids'

export interface BaseNode {
  id: NodeId
  name?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  zIndex: number
}

export interface ImageNode extends BaseNode { type: 'image'; assetId: AssetId }
export interface VideoNode extends BaseNode { type: 'video'; assetId: AssetId; startTime?: number; duration?: number }
export interface TextNode extends BaseNode { type: 'text'; text: string; fontFamily: string; fontSize: number }
export interface ShapeNode extends BaseNode { type: 'shape'; shape: 'rect' | 'ellipse'; fill: string }
export interface GenerationNode extends BaseNode {
  type: 'generation'
  generationId: GenerationId
  outputAssetId?: AssetId
}

export type EditorNode = ImageNode | VideoNode | TextNode | ShapeNode | GenerationNode
