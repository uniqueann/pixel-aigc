import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Alert, App, Button, Segmented, Space } from 'antd'
import { Capability } from '@/types'
import ProjectToolbar from '@/editor/persistence/ProjectToolbar'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import type { GenerationDraft } from '@/editor/persistence/types'
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
  useFreeCanvasGenerationController,
} from '@/features/free-canvas/generation/useFreeCanvasGenerationController'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import type { FreeCanvasStageHandle, NodeTransform } from '@/features/free-canvas/types'
import { CANVAS_MODES } from './modes'

function isEditingText(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export default function FreeCanvas() {
  const { mode } = useParams<{ mode: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const activeSlug = CANVAS_MODES.find((m) => m.slug === mode)?.slug === 'text-to-video' ? 'text-to-video' : 'text-to-image'
  const drafts = usePersistenceStore((state) => state.drafts)
  const { prompt, presetKey, count, durationSeconds } = drafts[activeSlug]
  const updateDraft = (changes: Partial<GenerationDraft>) => {
    const state = usePersistenceStore.getState()
    state.setDrafts({ ...state.drafts, [activeSlug]: { ...state.drafts[activeSlug], ...changes } })
  }
  const derivedDraft = drafts.derived
  const derivedAsset = useEditorStore((state) => derivedDraft ? state.project?.assets[derivedDraft.sourceAssetId] : undefined)
  const derivedContext = derivedDraft && derivedAsset?.type === 'image'
    ? { mode: derivedDraft.mode, source: { node: derivedDraft.sourceNode, asset: derivedAsset } }
    : undefined
  const updateDerived = (changes: Partial<NonNullable<typeof derivedDraft>>) => {
    const state = usePersistenceStore.getState()
    if (state.drafts.derived) state.setDrafts({ ...state.drafts, derived: { ...state.drafts.derived, ...changes } })
  }
  const derivedPrompt = derivedDraft?.prompt ?? ''
  const variationCount = derivedDraft?.count ?? 4
  const derivedDurationSeconds = derivedDraft?.durationSeconds ?? 5
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
  const scene = project?.document.scenes.find((item) => item.id === activeSceneId)
  const generation = useFreeCanvasGenerationController(scene?.id)

  useEffect(() => {
    ensureFreeCanvasContent()
    return () => { void flushProject().catch(() => undefined) }
  }, [])

  useEffect(() => {
    const task = generation.task
    if (task && generation.formLocked && !derivedDraft) {
      const target = task.capability === Capability.TextToVideo ? 'text-to-video' : 'text-to-image'
      if (activeSlug !== target) navigate(`/canvas/${target}`, { replace: true })
    }
  }, [activeSlug, derivedDraft, generation.formLocked, generation.task, navigate])

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
    const persistence = usePersistenceStore.getState()
    persistence.setDrafts({ ...persistence.drafts, derived: { mode: action, sourceNode: { ...node }, sourceAssetId: asset.id, prompt: '', count: 4, durationSeconds: 5 } })
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
    const persistence = usePersistenceStore.getState()
    persistence.setDrafts({ ...persistence.drafts, derived: undefined })
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
      <ProjectToolbar busy={generation.submitting || generation.active || !!generation.pendingSubmission} />
      {generation.pendingSubmission && !generation.submitting && <Alert type="warning" showIcon message="生成请求等待恢复" description="继续操作会使用原幂等键确认同一次请求，避免重复生成；放弃后将清理本地等待状态。" action={<Space>
        <Button onClick={() => { void generation.resumeSubmission() }}>继续原请求</Button>
        <Button onClick={generation.abandonSubmission}>放弃等待</Button>
      </Space>} />}
      {generation.pollError && <Alert type="warning" message="原任务暂时无法查询" description={generation.pollError.message} action={<Button onClick={generation.modifyParameters}>放弃占位并修改参数</Button>} />}
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
            onPromptChange={(prompt) => updateDerived({ prompt })}
            onCountChange={(count) => updateDerived({ count })}
            onDurationChange={(durationSeconds) => updateDerived({ durationSeconds })}
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
            onPromptChange={(prompt) => updateDraft({ prompt })}
            onPresetChange={(presetKey) => updateDraft({ presetKey })}
            onCountChange={(count) => updateDraft({ count })}
            onDurationChange={(durationSeconds) => updateDraft({ durationSeconds })}
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
