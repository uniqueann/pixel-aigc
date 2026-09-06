import type { StateCreator } from 'zustand'
import type { Asset, EditorNode, GenerationJob, PixelProject, SceneId } from '@/editor/types'
import type { EditorStoreState } from './editorStore'

export interface ProjectSlice {
  project: PixelProject | null
  activeSceneId: SceneId | null
  createProject: (name: string, size?: { width: number; height: number }) => PixelProject
  loadProject: (project: PixelProject) => void
  setActiveScene: (sceneId: SceneId) => void
  addNode: (sceneId: SceneId, node: EditorNode) => void
  removeNode: (sceneId: SceneId, nodeId: string) => void
  updateNode: (sceneId: SceneId, nodeId: string, changes: Partial<EditorNode>) => void
  registerAsset: (asset: Asset) => void
  registerGeneration: (generation: GenerationJob) => void
}

const now = () => new Date().toISOString()

export const createProjectSlice: StateCreator<EditorStoreState, [], [], ProjectSlice> = (set) => ({
  project: null,
  activeSceneId: null,
  createProject: (name, size = { width: 1280, height: 720 }) => {
    const createdAt = now()
    const sceneId = crypto.randomUUID()
    const project: PixelProject = {
      id: crypto.randomUUID(),
      name,
      document: {
        version: 1,
        activeSceneId: sceneId,
        scenes: [{
          id: sceneId,
          name: '场景 1',
          width: size.width,
          height: size.height,
          nodes: [],
          viewport: { zoom: 1, panX: 0, panY: 0 },
        }],
      },
      assets: {},
      generations: {},
      createdAt,
      updatedAt: createdAt,
    }
    set({
      project,
      activeSceneId: sceneId,
      viewport: project.document.scenes[0].viewport,
      selectedNodeIds: [],
      undoStack: [],
      redoStack: [],
    })
    return project
  },
  loadProject: (project) => {
    const activeScene = project.document.scenes.find((scene) => scene.id === project.document.activeSceneId)
    if (!activeScene) throw new Error('项目的活动场景不存在')
    set({
      project,
      activeSceneId: activeScene.id,
      viewport: activeScene.viewport,
      selectedNodeIds: [],
      undoStack: [],
      redoStack: [],
    })
  },
  setActiveScene: (sceneId) => set((state) => {
    if (!state.project) return state
    const scene = state.project.document.scenes.find((item) => item.id === sceneId)
    if (!scene) return state
    return {
      project: {
        ...state.project,
        document: { ...state.project.document, activeSceneId: sceneId },
        updatedAt: now(),
      },
      activeSceneId: sceneId,
      viewport: scene.viewport,
      selectedNodeIds: [],
    }
  }),
  addNode: (sceneId, node) => set((state) => ({
    project: updateScene(state.project, sceneId, (nodes) => [...nodes, node]),
  })),
  removeNode: (sceneId, nodeId) => set((state) => ({
    project: updateScene(state.project, sceneId, (nodes) => nodes.filter((node) => node.id !== nodeId)),
    selectedNodeIds: state.selectedNodeIds.filter((id) => id !== nodeId),
  })),
  updateNode: (sceneId, nodeId, changes) => set((state) => ({
    project: updateScene(state.project, sceneId, (nodes) =>
      nodes.map((node) => node.id === nodeId ? ({ ...node, ...changes, id: node.id, type: node.type } as EditorNode) : node),
    ),
  })),
  registerAsset: (asset) => set((state) => ({
    project: state.project ? {
      ...state.project,
      assets: { ...state.project.assets, [asset.id]: asset },
      updatedAt: now(),
    } : null,
  })),
  registerGeneration: (generation) => set((state) => ({
    project: state.project ? {
      ...state.project,
      generations: { ...state.project.generations, [generation.id]: generation },
      updatedAt: now(),
    } : null,
  })),
})

function updateScene(
  project: PixelProject | null,
  sceneId: SceneId,
  updateNodes: (nodes: EditorNode[]) => EditorNode[],
): PixelProject | null {
  if (!project) return null
  return {
    ...project,
    document: {
      ...project.document,
      scenes: project.document.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, nodes: updateNodes(scene.nodes) } : scene,
      ),
    },
    updatedAt: now(),
  }
}
