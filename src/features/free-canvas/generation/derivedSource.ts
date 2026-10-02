import type { Asset, ImageAsset, ImageNode, Scene } from '@/editor/types'

export function resolveSelectedImageSource(
  scene: Scene | undefined,
  assets: Record<string, Asset> | undefined,
  selectedNodeId?: string,
) {
  const node = scene?.nodes.find((item): item is ImageNode => item.id === selectedNodeId && item.type === 'image')
  const asset = node ? assets?.[node.assetId] : undefined
  if (!node || asset?.type !== 'image') return undefined
  return { node, asset }
}
