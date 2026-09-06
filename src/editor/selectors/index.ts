import type { AssetId, GenerationId } from '@/editor/types'
import type { EditorStoreState } from '@/editor/store'

export const selectActiveScene = (state: EditorStoreState) =>
  state.project?.document.scenes.find((scene) => scene.id === state.activeSceneId)

export const selectSelectedNodes = (state: EditorStoreState) => {
  const selected = new Set(state.selectedNodeIds)
  return selectActiveScene(state)?.nodes.filter((node) => selected.has(node.id)) ?? []
}

export const selectAssetById = (assetId: AssetId) => (state: EditorStoreState) =>
  state.project?.assets[assetId]

export const selectGenerationById = (generationId: GenerationId) => (state: EditorStoreState) =>
  state.project?.generations[generationId]

export const selectGenerationParents = (generationId: GenerationId) => (state: EditorStoreState) => {
  const project = state.project
  const generation = project?.generations[generationId]
  if (!project || !generation) return []
  const inputs = new Set(generation.inputAssetIds)
  return Object.values(project.generations).filter((candidate) =>
    candidate.id !== generationId && candidate.outputAssetIds.some((assetId) => inputs.has(assetId)),
  )
}

export const selectGenerationChildren = (generationId: GenerationId) => (state: EditorStoreState) => {
  const project = state.project
  const generation = project?.generations[generationId]
  if (!project || !generation) return []
  const outputs = new Set(generation.outputAssetIds)
  return Object.values(project.generations).filter((candidate) =>
    candidate.id !== generationId && candidate.inputAssetIds.some((assetId) => outputs.has(assetId)),
  )
}

export const selectAssetOrigin = (assetId: AssetId) => (state: EditorStoreState) => {
  const project = state.project
  if (!project) return undefined
  const asset = project.assets[assetId]
  if (asset?.generationId) return project.generations[asset.generationId]
  return Object.values(project.generations).find((generation) => generation.outputAssetIds.includes(assetId))
}
