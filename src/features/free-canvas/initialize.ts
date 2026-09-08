import { DEMO_IMAGE_ASSET } from '@/editor/services/demoImageAsset'
import { useEditorStore } from '@/editor/store'
import type { ImageAsset } from '@/editor/types'
import { calculateInitialImageNode } from './geometry'

export function ensureFreeCanvasContent() {
  let state = useEditorStore.getState()
  const isNew = !state.project
  if (!state.project) {
    state.createProject('自由画布', { width: 1280, height: 720 })
    state = useEditorStore.getState()
  }

  const sceneId = state.activeSceneId
  const project = state.project
  if (!project || !sceneId || !isNew) return

  const scene = project.document.scenes.find((item) => item.id === sceneId)
  if (!scene || scene.nodes.length > 0) return

  const latestImageAsset = Object.values(project.assets)
    .filter((asset): asset is ImageAsset => asset.type === 'image')
    .reduce<ImageAsset | undefined>((latest, asset) => (
      !latest || asset.createdAt > latest.createdAt ? asset : latest
    ), undefined)
  const asset = latestImageAsset ?? DEMO_IMAGE_ASSET

  if (!project.assets[asset.id]) state.registerAsset(asset)
  const node = calculateInitialImageNode(asset, scene)
  state.addNode(sceneId, node)
  state.selectNodes([node.id])
}
