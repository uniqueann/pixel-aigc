import { useCallback, useEffect, useRef, useState } from 'react'
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
import { resolveSelectedImageSource } from '@/features/free-canvas/generation/derivedSource'
import { isCanvasMockGateway, isFreeCanvasTextToImageEntryEnabled, isFreeCanvasVariationEntryEnabled } from '@/features/free-canvas/generation/availability'
import { useCanvasTextToImageModels, useCanvasVariationModels } from '@/features/free-canvas/generation/useCanvasVariationModels'
import { resolveCanvasTextToImageParameters } from '@/features/free-canvas/generation/textToImageParameters'
import { resultAssetForTask } from '@/features/free-canvas/generation/resultAsset'
import { useCanvasImages } from '@/features/free-canvas/images/useCanvasImages'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'
import { importCanvasFile, importCanvasHistory, type CanvasImageImportContext } from '@/features/free-canvas/images/importImage'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import type { WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { usePreferencesStore } from '@/features/preferences/store'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
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
import { boundsFromPlacement, calculateNodeBounds } from '@/features/free-canvas/geometry'
import type { FreeCanvasStageHandle, NodeTransform } from '@/features/free-canvas/types'
import { CANVAS_MODES } from './modes'
import type { Asset } from '@/editor/types'

const EMPTY_ASSETS: Record<string, Asset> = {}

function isEditingText(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export default function FreeCanvas() {
  const { mode } = useParams<{ mode: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const configuration = useCanvasVariationModels()
  const textToImageConfiguration = useCanvasTextToImageModels()
  const preferences = usePreferencesStore(state => state.preferences)
  const ownerId = currentWorkstationHistoryOwner()
  const epoch = usePersistenceStore(state => state.epoch)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const importGate = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const importAbort = useRef(new AbortController())
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
  const variationCount = derivedDraft?.count ?? preferences.image.counts.variation
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
  const foreignSubmission = !!generation.pendingSubmission?.ownerId && generation.pendingSubmission.ownerId !== ownerId
  const taskResultCount = generation.task?.resultImages?.length || generation.task?.resultUrls?.length || 0
  const previewAssetIds = Array.from({ length: taskResultCount }, (_, index) => resultAssetForTask(generation.task, index, project?.assets ?? EMPTY_ASSETS)?.id).filter((id): id is string => !!id)
  const images = useCanvasImages(project?.assets ?? EMPTY_ASSETS, scene, derivedDraft?.sourceAssetId, previewAssetIds)
  const model = configuration.models.find(item => item.id === derivedDraft?.modelProfileId)
    ?? configuration.models.find(item => item.defaultFor?.includes('variation')) ?? configuration.models[0]
  const requestedResolution = derivedDraft?.resolution ?? preferences.image.resolution
  const effective = effectiveImageParameters(variationCount, requestedResolution, derivedAsset?.type === 'image' ? derivedAsset : undefined, model?.ui)
  const estimatedCredits = effective.count * (model?.pricing?.creditsPerImage[effective.resolution] ?? 0)
  const textToImageParameters = resolveCanvasTextToImageParameters(drafts['text-to-image'], preferences.image.resolution, textToImageConfiguration.models)
  const mockGateway = isCanvasMockGateway()
  const textToImageEntryEnabled = isFreeCanvasTextToImageEntryEnabled() && textToImageParameters.presets.length > 0 && (mockGateway || textToImageParameters.pricingReady)

  useEffect(() => {
    const controller = new AbortController()
    importAbort.current = controller
    return () => controller.abort()
  }, [project?.id, epoch, ownerId])

  useEffect(() => {
    if (!derivedDraft || generation.formLocked) return
    const selected = resolveSelectedImageSource(scene, project?.assets, selectedNodeId)
    if (!selected) return
    if (derivedDraft.sourceNode.id === selected.node.id && derivedDraft.sourceAssetId === selected.asset.id) return
    const persistence = usePersistenceStore.getState()
    if (persistence.drafts.derived) {
      persistence.setDrafts({
        ...persistence.drafts,
        derived: { ...persistence.drafts.derived, sourceNode: { ...selected.node }, sourceAssetId: selected.asset.id },
      })
    }
  }, [derivedDraft, generation.formLocked, project?.assets, scene, selectedNodeId])

  const importPicture = async (input: File | WorkstationHistoryListItem) => {
    if (importGate.current || !project || !scene) return
    importGate.current = true
    setImporting(true)
    const context: CanvasImageImportContext = {
      ownerId, projectId: project.id, sceneId: scene.id, epoch, signal: importAbort.current.signal,
      center: stageRef.current?.getViewportCenter() ?? { x: scene.width / 2, y: scene.height / 2 },
    }
    try {
      const imported = input instanceof File ? await importCanvasFile(input, context) : await importCanvasHistory(input, context)
      if (!context.signal.aborted) {
        stageRef.current?.revealBounds([calculateNodeBounds(imported.node)])
        setPickerOpen(false)
        await flushProject()
      }
    } catch (error) {
      if (!context.signal.aborted) message.error(error instanceof Error ? error.message : '图片添加失败')
    } finally {
      importGate.current = false
      if (!context.signal.aborted) setImporting(false)
    }
  }

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
    if (activeSlug === 'text-to-video' && !mockGateway) {
      message.warning('视频真实生成尚未接入，目前仅支持模拟模式')
      return
    }
    if (activeSlug === 'text-to-image' && !textToImageEntryEnabled) {
      message.warning('请先确认登录与文生图模型配置')
      return
    }
    const promptMaxLength = textToImageParameters.model?.ui.promptMaxLength
    if (activeSlug === 'text-to-image' && promptMaxLength && prompt.trim().length > promptMaxLength) {
      message.warning(`画面描述最多 ${promptMaxLength} 个字符`)
      return
    }
    const preset = IMAGE_SIZE_PRESETS.find((item) => item.key === presetKey) ?? IMAGE_SIZE_PRESETS[0]
    const center = stageRef.current?.getViewportCenter() ?? {
      x: scene?.width ? scene.width / 2 : 0,
      y: scene?.height ? scene.height / 2 : 0,
    }
    try {
      const request = activeSlug === 'text-to-video'
        ? buildTextToVideoRequest(prompt, preset, durationSeconds)
        : buildTextToImageRequest(prompt, textToImageParameters.preset, textToImageParameters.count, { resolution: textToImageParameters.resolution, modelProfileId: textToImageParameters.model?.id })
      if (activeSlug === 'text-to-image') {
        updateDraft({ modelProfileId: textToImageParameters.model?.id, resolution: textToImageParameters.requestedResolution })
      }
      void generation.generate(request, center)
    } catch (error) { message.error(error instanceof Error ? error.message : '生成参数无效') }
  }

  const handleNodeGenerationAction = useCallback((action: DerivedGenerationMode, nodeId: string) => {
    if (action === 'variation' && !isFreeCanvasVariationEntryEnabled() && !configuration.loading) {
      message.warning('请先确认登录与裂变模型配置')
      return
    }
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
    const previous = persistence.drafts.derived
    persistence.setDrafts({ ...persistence.drafts, derived: {
      mode: action, sourceNode: { ...node }, sourceAssetId: asset.id, prompt: '',
      count: previous?.count ?? preferences.image.counts.variation, durationSeconds: previous?.durationSeconds ?? 5,
      resolution: previous?.resolution ?? preferences.image.resolution, modelProfileId: previous?.modelProfileId ?? model?.id,
    } })
  }, [configuration.loading, generation, message, preferences.image, model?.id])

  const variationEntryEnabled = isFreeCanvasVariationEntryEnabled()
  const handleDerivedGenerate = () => {
    const selected = resolveSelectedImageSource(scene, project?.assets, selectedNodeId)
    const source = selected ?? derivedContext?.source
    if (!derivedContext || !source) return
    if (derivedContext.mode === 'image-to-video' && !mockGateway) {
      message.warning('视频真实生成尚未接入，目前仅支持模拟模式')
      return
    }
    if (derivedContext.mode === 'variation' && !variationEntryEnabled) {
      message.warning('请先确认登录与裂变模型配置')
      return
    }
    try {
      const request = derivedContext.mode === 'variation'
        ? buildVariationRequest(source.asset, derivedPrompt, effective.count, { resolution: effective.resolution, modelProfileId: model?.id })
        : buildImageToVideoRequest(source.asset, derivedPrompt, derivedDurationSeconds)
      if (derivedContext.mode === 'variation') updateDerived({ count: effective.count, resolution: effective.resolution, modelProfileId: model?.id, sourceNode: { ...source.node }, sourceAssetId: source.asset.id })
      void generation.generateDerived(request, source).then((placements) => {
        if (!placements?.length) return
        stageRef.current?.revealBounds([calculateNodeBounds(source.node), ...placements.map(boundsFromPlacement)])
      })
    } catch (error) { message.error(error instanceof Error ? error.message : '生成参数无效') }
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
      <ProjectToolbar busy={importing || generation.submitting || generation.active || !!generation.pendingSubmission} onUploadImage={() => fileInput.current?.click()} />
      {pickerOpen && <CanvasAssetPicker key={ownerId} ownerId={ownerId} busy={importing} onSelect={importPicture} onClose={() => { if (!importing) setPickerOpen(false) }} />}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="上传图片到画布" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void importPicture(file)
      }} />
      {images.error && <Alert type="warning" showIcon message="画布图片读取失败" description={images.error} action={<Button onClick={images.reload}>重试读取图片</Button>} />}
      {configuration.error && <Alert type="warning" showIcon message="裂变模型配置读取失败" description={configuration.error} action={<Button onClick={configuration.reload}>重新读取配置</Button>} />}
      {textToImageConfiguration.error && <Alert type="warning" showIcon message="文生图模型配置读取失败" description={textToImageConfiguration.error} action={<Button onClick={textToImageConfiguration.reload}>重新读取文生图配置</Button>} />}
      {generation.pendingSubmission && !generation.submitting && <Alert type="warning" showIcon message={foreignSubmission ? '此任务属于其他账号' : '生成请求等待恢复'} description={foreignSubmission ? '当前账号无法续接此任务。放弃等待可清理本地占位，继续编辑画布。' : '继续操作会使用原幂等键确认同一次请求，避免重复生成；放弃后将清理本地等待状态。'} action={<Space>
        {!foreignSubmission && <Button onClick={() => { void generation.resumeSubmission() }}>继续原请求</Button>}
        <Button onClick={generation.abandonSubmission}>放弃等待</Button>
      </Space>} />}
      {generation.pollError && <Alert type="warning" message="原任务暂时无法查询" description={generation.pollError.message} action={<Button onClick={generation.modifyParameters}>放弃占位并修改参数</Button>} />}
      <div className="free-canvas-page-header">
        <Segmented
          options={CANVAS_MODES.map((item) => ({ label: item.label, value: item.slug }))}
          value={activeSlug}
          onChange={(value) => navigate(`/canvas/${value}`)}
        />
        <Space wrap><Button loading={importing} disabled={generation.submitting || !!generation.pendingSubmission} onClick={() => fileInput.current?.click()}>上传图片</Button>
          <Button disabled={importing || generation.submitting || !!generation.pendingSubmission} onClick={() => setPickerOpen(true)}>从我的资产添加</Button>
          <span>{scene.width} × {scene.height}</span>
        </Space>
      </div>
      <div className="free-canvas-workspace">
        <FreeCanvasStage
          key={scene.id}
          ref={stageRef}
          scene={scene}
          assets={images.assets}
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
          variationEnabled={variationEntryEnabled || configuration.loading}
          onNodeGenerationAction={handleNodeGenerationAction}
          onAssetLoadError={handleAssetLoadError}
        />
        {derivedContext ? (
          <DerivedGenerationPanel
            mode={derivedContext.mode}
            sourceAsset={images.assets[derivedContext.source.asset.id] as typeof derivedContext.source.asset}
            prompt={derivedPrompt}
            count={derivedContext.mode === 'variation' ? effective.count : variationCount}
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
            generateDisabled={derivedContext.mode === 'variation' ? !variationEntryEnabled : !mockGateway}
            modelsLoading={derivedContext.mode === 'variation' && configuration.loading}
            onGenerate={handleDerivedGenerate}
            onRetry={() => { void generation.retry() }}
            onModifyParameters={generation.modifyParameters}
            onRefetch={() => { void generation.refetch() }}
            models={configuration.models}
            modelProfileId={model?.id}
            resolution={effective.resolution}
            onModelChange={modelProfileId => updateDerived({ modelProfileId })}
            onResolutionChange={resolution => updateDerived({ resolution })}
            estimatedCredits={estimatedCredits}
            resolutionAdjusted={effective.resolution !== requestedResolution}
            mockGateway={mockGateway}
            preparationPhase={generation.preparationPhase}
            historyError={generation.historyError}
            historySaved={generation.historySaved}
            onRetrySave={generation.retryHistory}
            resultAssets={images.assets}
          />
        ) : (
          <GenerationPanel
            mode={activeSlug}
            prompt={prompt}
            presetKey={activeSlug === 'text-to-image' ? textToImageParameters.preset.key : presetKey}
            count={activeSlug === 'text-to-image' ? textToImageParameters.count : count}
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
            models={textToImageConfiguration.models}
            modelProfileId={textToImageParameters.model?.id}
            resolution={textToImageParameters.resolution}
            onModelChange={modelProfileId => updateDraft({ modelProfileId })}
            onResolutionChange={resolution => updateDraft({ resolution })}
            estimatedCredits={textToImageParameters.estimatedCredits}
            resolutionAdjusted={textToImageParameters.resolutionAdjusted}
            ratioAdjusted={textToImageParameters.ratioAdjusted}
            countAdjusted={textToImageParameters.countAdjusted}
            modelsLoading={textToImageConfiguration.loading}
            generateDisabled={activeSlug === 'text-to-image' ? !textToImageEntryEnabled : !mockGateway}
            mockGateway={mockGateway}
            historyError={generation.historyError}
            historySaved={generation.historySaved}
            onRetrySave={generation.retryHistory}
            resultAssets={images.assets}
          />
        )}
      </div>
    </div>
  )
}
