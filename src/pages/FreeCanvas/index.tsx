import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Segmented } from 'antd'
import { RemoveNodeCommand, UpdateNodeCommand } from '@/editor/commands'
import { useEditorStore } from '@/editor/store'
import FreeCanvasStage from '@/features/free-canvas/FreeCanvasStage'
import DerivedGenerationPanel, {
  type DerivedGenerationMode,
} from '@/features/free-canvas/generation/DerivedGenerationPanel'
import GenerationPanel from '@/features/free-canvas/generation/GenerationPanel'
import { IMAGE_SIZE_PRESETS } from '@/features/free-canvas/generation/config'
import {
  buildImageToVideoRequest,
  buildTextToImageRequest,
  buildTextToVideoRequest,
  buildVariationRequest,
} from '@/features/free-canvas/generation/requestBuilder'
import {
  type DerivedGenerationSource,
  useFreeCanvasGenerationController,
} from '@/features/free-canvas/generation/useFreeCanvasGenerationController'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import type { FreeCanvasStageHandle, NodeTransform } from '@/features/free-canvas/types'
import { CANVAS_MODES } from './modes'

interface DerivedGenerationContext {
  mode: DerivedGenerationMode
  source: DerivedGenerationSource
}

function isEditingText(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export default function FreeCanvas() {
  const { mode } = useParams<{ mode: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [prompt, setPrompt] = useState('')
  const [presetKey, setPresetKey] = useState(IMAGE_SIZE_PRESETS[0].key)
  const [count, setCount] = useState(1)
  const [durationSeconds, setDurationSeconds] = useState(5)
  const [derivedContext, setDerivedContext] = useState<DerivedGenerationContext>()
  const [derivedPrompt, setDerivedPrompt] = useState('')
  const [variationCount, setVariationCount] = useState(4)
  const [derivedDurationSeconds, setDerivedDurationSeconds] = useState(5)
  const stageRef = useRef<FreeCanvasStageHandle>(null)
  const project = useEditorStore((state) => state.project)
  const activeSceneId = useEditorStore((state) => state.activeSceneId)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeIds[0])
  const viewport = useEditorStore((state) => state.viewport)
  const canUndo = useEditorStore((state) => state.undoStack.length > 0)
  const canRedo = useEditorStore((state) => state.redoStack.length > 0)
  const selectNodes = useEditorStore((state) => state.selectNodes)
  const executeCommand = useEditorStore((state) => state.executeCommand)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setViewport = useEditorStore((state) => state.setViewport)
  const activeSlug = CANVAS_MODES.find((m) => m.slug === mode)?.slug ?? CANVAS_MODES[0].slug
  const scene = project?.document.scenes.find((item) => item.id === activeSceneId)
  const generation = useFreeCanvasGenerationController(scene?.id)

  useEffect(() => {
    ensureFreeCanvasContent()
  }, [])

  const handleSelectNode = useCallback((nodeId?: string) => {
    selectNodes(nodeId ? [nodeId] : [])
  }, [selectNodes])

  const handleTransformNode = useCallback((nodeId: string, transform: NodeTransform) => {
    const state = useEditorStore.getState()
    const currentScene = state.project?.document.scenes.find((item) => item.id === state.activeSceneId)
    const node = currentScene?.nodes.find((item) => item.id === nodeId)
    if (!currentScene || !node) return
    if (node.type === 'generation') {
      state.updateNode(currentScene.id, nodeId, { x: transform.x, y: transform.y })
      return
    }
    executeCommand(new UpdateNodeCommand(currentScene.id, nodeId, transform))
  }, [executeCommand])

  const handleDelete = useCallback(() => {
    const state = useEditorStore.getState()
    const nodeId = state.selectedNodeIds[0]
    if (!state.activeSceneId || !nodeId) return
    const currentScene = state.project?.document.scenes.find((item) => item.id === state.activeSceneId)
    if (currentScene?.nodes.find((node) => node.id === nodeId)?.type === 'generation') return
    state.executeCommand(new RemoveNodeCommand(state.activeSceneId, nodeId))
  }, [])

  const handleGenerate = () => {
    const preset = IMAGE_SIZE_PRESETS.find((item) => item.key === presetKey) ?? IMAGE_SIZE_PRESETS[0]
    const center = stageRef.current?.getViewportCenter() ?? {
      x: scene?.width ? scene.width / 2 : 0,
      y: scene?.height ? scene.height / 2 : 0,
    }
    const request = activeSlug === 'text-to-video'
      ? buildTextToVideoRequest(prompt, preset, durationSeconds)
      : buildTextToImageRequest(prompt, preset, count)
    void generation.generate(request, center)
  }

  const handleNodeGenerationAction = useCallback((action: DerivedGenerationMode, nodeId: string) => {
    const state = useEditorStore.getState()
    const currentScene = state.project?.document.scenes.find((item) => item.id === state.activeSceneId)
    const node = currentScene?.nodes.find((item) => item.id === nodeId)
    const asset = node?.type === 'image' ? state.project?.assets[node.assetId] : undefined
    if (!node || node.type !== 'image' || !asset || asset.type !== 'image') {
      message.error({ content: '源图片不可用，无法发起派生生成', duration: 4 })
      return
    }
    generation.dismissTask()
    setDerivedContext({ mode: action, source: { node: { ...node }, asset } })
    setDerivedPrompt('')
    setVariationCount(4)
    setDerivedDurationSeconds(5)
  }, [generation, message])

  const handleDerivedGenerate = () => {
    if (!derivedContext) return
    const request = derivedContext.mode === 'variation'
      ? buildVariationRequest(derivedContext.source.asset, derivedPrompt, variationCount)
      : buildImageToVideoRequest(derivedContext.source.asset, derivedPrompt, derivedDurationSeconds)
    void generation.generateDerived(request, derivedContext.source)
  }

  const handleCloseDerived = () => {
    generation.dismissTask()
    setDerivedContext(undefined)
  }

  const handleAssetLoadError = useCallback((content: string) => {
    message.error({ content, duration: 4 })
  }, [message])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isEditingText(event.target)) return
      const commandKey = event.metaKey || event.ctrlKey
      if (commandKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [handleDelete, redo, undo])

  if (!project || !scene) {
    return <div className="free-canvas-loading">正在准备自由画布…</div>
  }

  return (
    <div className="free-canvas-page">
      <div className="free-canvas-page-header">
        <Segmented
          options={CANVAS_MODES.map((item) => ({ label: item.label, value: item.slug }))}
          value={activeSlug}
          onChange={(value) => navigate(`/canvas/${value}`)}
        />
        <span>{scene.width} × {scene.height}</span>
      </div>
      <div className="free-canvas-workspace">
        <FreeCanvasStage
          key={scene.id}
          ref={stageRef}
          scene={scene}
          assets={project.assets}
          generations={project.generations}
          selectedNodeId={selectedNodeId}
          viewport={viewport}
          canUndo={canUndo}
          canRedo={canRedo}
          generationActive={generation.formLocked}
          onSelectNode={handleSelectNode}
          onTransformNode={handleTransformNode}
          onViewportChange={setViewport}
          onUndo={undo}
          onRedo={redo}
          onDelete={handleDelete}
          onNodeGenerationAction={handleNodeGenerationAction}
          onAssetLoadError={handleAssetLoadError}
        />
        {derivedContext ? (
          <DerivedGenerationPanel
            mode={derivedContext.mode}
            sourceAsset={derivedContext.source.asset}
            prompt={derivedPrompt}
            count={variationCount}
            durationSeconds={derivedDurationSeconds}
            task={generation.task}
            submitting={generation.submitting}
            autoRetrying={generation.autoRetrying}
            active={generation.active}
            formLocked={generation.formLocked}
            polling={generation.polling}
            submissionError={generation.submissionError}
            protocolError={generation.protocolError}
            pollError={generation.pollError}
            onBack={handleCloseDerived}
            onPromptChange={setDerivedPrompt}
            onCountChange={setVariationCount}
            onDurationChange={setDerivedDurationSeconds}
            onGenerate={handleDerivedGenerate}
            onRetry={() => { void generation.retry() }}
            onModifyParameters={generation.modifyParameters}
            onRefetch={() => { void generation.refetch() }}
          />
        ) : (
          <GenerationPanel
            mode={activeSlug}
            prompt={prompt}
            presetKey={presetKey}
            count={count}
            durationSeconds={durationSeconds}
            task={generation.task}
            submitting={generation.submitting}
            active={generation.active}
            formLocked={generation.formLocked}
            polling={generation.polling}
            submissionError={generation.submissionError}
            protocolError={generation.protocolError}
            pollError={generation.pollError}
            onPromptChange={setPrompt}
            onPresetChange={setPresetKey}
            onCountChange={setCount}
            onDurationChange={setDurationSeconds}
            onGenerate={handleGenerate}
            onRetry={() => { void generation.retry() }}
            onModifyParameters={generation.modifyParameters}
            onRefetch={() => { void generation.refetch() }}
          />
        )}
      </div>
    </div>
  )
}
