import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams,useSearchParams } from 'react-router-dom'
import CanvasTaskRecovery from '@/features/task-center/CanvasTaskRecovery'
import { parseTaskRoute } from '@/features/task-center/route'
import { App, Segmented } from 'antd'
import { Capability } from '@/types'
import CloudToolbar from '@/cloud/CloudToolbar'
import { useCloudStore } from '@/cloud/sync'
import { useCanvasActionGate } from '@/layouts/canvasActionGate'
import { flushProject, copyProjectLocally, hasUnfinishedGeneration } from '@/editor/persistence/projectPersistence'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import type { GenerationDraft, VideoReplicationDraft } from '@/editor/persistence/types'
import { generationIdForTask } from '@/editor/adapters/taskAdapter'
import { AddNodeCommand, CompositeCommand, RemoveNodeCommand, UpdateNodeCommand } from '@/editor/commands'
import { useEditorStore } from '@/editor/store'
import FreeCanvasStage from '@/features/free-canvas/FreeCanvasStage'
import DerivedGenerationPanel, {
  type DerivedGenerationMode,
} from '@/features/free-canvas/generation/DerivedGenerationPanel'
import VideoReplicationPanel from '@/features/free-canvas/generation/VideoReplicationPanel'
import { inspectVideoReference, uploadVideoReference } from '@/services/api/videoReferences'
import { videoReplicationCredits, videoReplicationDefaults, type VideoReplicationTaskParams } from '@shared/video-replication'
import GenerationPanel from '@/features/free-canvas/generation/GenerationPanel'
import { resolveSelectedImageSource } from '@/features/free-canvas/generation/derivedSource'
import { isCanvasMockGateway, isFreeCanvasTextToImageEntryEnabled, isFreeCanvasVariationEntryEnabled } from '@/features/free-canvas/generation/availability'
import { useCanvasTextToImageModels, useCanvasVariationModels } from '@/features/free-canvas/generation/useCanvasVariationModels'
import { useCanvasVideoModels } from '@/features/free-canvas/generation/useCanvasVideoModels'
import { resolveCanvasTextToImageParameters } from '@/features/free-canvas/generation/textToImageParameters'
import { selectedCanvasVideoModel, videoModelIdForDraft } from '@/features/free-canvas/generation/videoParameters'
import { videoModelModes, videoModelAvailableForMode, videoGenerateAudio } from '@shared/video-models'
import { videoCreditsForDuration } from '@/features/free-canvas/generation/videoCredits'
import { resultAssetForTask } from '@/features/free-canvas/generation/resultAsset'
import { useCanvasImages } from '@/features/free-canvas/images/useCanvasImages'
import { useCanvasVideos } from '@/features/free-canvas/images/useCanvasVideos'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'
import { importCanvasFile, importCanvasHistory, type CanvasImageImportContext } from '@/features/free-canvas/images/importImage'
import { useUserStore } from '@/store/useUserStore'
import { currentWorkstationHistoryOwner, isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import type { WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { usePreferencesStore } from '@/features/preferences/store'
import { matchImageModel } from '@shared/image-models'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
import { IMAGE_SIZE_PRESETS } from '@/features/free-canvas/generation/config'
import {
  buildImageToVideoRequest,
  buildTextToImageRequest,
  buildTextToVideoRequest,
  buildVariationRequest,
  buildVideoReplicationRequest,
} from '@/features/free-canvas/generation/requestBuilder'
import {
  useFreeCanvasGenerationController,
} from '@/features/free-canvas/generation/useFreeCanvasGenerationController'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import { boundsFromPlacement, calculateNodeBounds, NODE_CASCADE_OFFSET, offsetPlacementToAvoidOverlap } from '@/features/free-canvas/geometry'
import { nextZIndex, reorderZIndex, type ZOrderAction } from '@/features/free-canvas/zOrder'
import { buildPastedNodes, copyNodesToClipboard, readClipboard } from '@/features/free-canvas/clipboard'
import type { FreeCanvasStageHandle, NodeTransformUpdate } from '@/features/free-canvas/types'
import { CANVAS_MODES, VIDEO_REPLICATION_MODE, canvasModeLabel } from './modes'
import { i18n } from '@/i18n'
import { imageCreditAmount } from '@/features/credits/quotes'
import { capabilityAvailabilityLabel } from '@/components/capabilityAvailability'
import CanvasAddImageButton from './CanvasAddImageButton'
import CanvasEmptyState from '@/features/free-canvas/CanvasEmptyState'
import CanvasNoticeBar, { type CanvasNotice } from '@/features/free-canvas/CanvasNoticeBar'
import SelectionSummary from '@/features/free-canvas/SelectionSummary'
import { imageFileError } from '@/services/api/upload'
import type { Asset, EditorNode, ImageAsset, PixelProject, VideoAsset } from '@/editor/types'

const EMPTY_ASSETS: Record<string, Asset> = {}

function isEditingText(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/** 生成中的占位框不能删除/复制；失败与取消属于可清理的终态。 */
function isTerminalGeneration(node: EditorNode, project: PixelProject | null | undefined) {
  if (node.type !== 'generation') return true
  const status = project?.generations[node.generationId]?.status
  return status === 'failed' || status === 'cancelled'
}

export default function FreeCanvas() {
  const { t } = useTranslation('canvas')
  const { mode } = useParams<{ mode: string }>()
  const [routeParams]=useSearchParams()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const configuration = useCanvasVariationModels()
  const textToImageConfiguration = useCanvasTextToImageModels()
  const videoConfiguration = useCanvasVideoModels()
  const queryClient = useQueryClient()
  const [referenceBusy, setReferenceBusy] = useState(false)
  const [referenceError, setReferenceError] = useState<string>()
  const referenceGate = useRef(false)
  const [referenceClock, setReferenceClock] = useState(Date.now)
  const cloudProject = usePersistenceStore(state => state.cloud)
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
  const replicationTab = mode === VIDEO_REPLICATION_MODE.slug
  const replicationPricing = videoConfiguration.replicationModel?.replicationPricing
  const defaultReplication: VideoReplicationDraft = { ownerId, prompt: '', ratio: '9:16', durationSeconds: 5 }
  const replication = drafts.videoReplication?.ownerId === ownerId ? drafts.videoReplication : defaultReplication
  const referenceKey = replication.reference?.key
  const referenceExpired = !!replication.reference && Date.parse(replication.reference.retentionExpiresAt) <= referenceClock
  useEffect(() => {
    if (!replicationTab || !referenceKey) return
    const timer = window.setInterval(() => setReferenceClock(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [replicationTab, referenceKey])
  const referenceQuery = useQuery({
    queryKey: ['canvas-video-reference', ownerId, referenceKey],
    queryFn: ({ signal }) => inspectVideoReference(referenceKey!, signal),
    enabled: replicationTab && !!replicationPricing && !cloudProject && !!referenceKey
      && !referenceExpired,
    retry: false,
    staleTime: 8 * 60_000,
    refetchInterval: 8 * 60_000,
  })
  const balance = useUserStore(state => state.creditsLoaded ? state.credits : undefined)
  const writable = usePersistenceStore(state => state.writable)
  const { prompt, presetKey, count, durationSeconds } = drafts[activeSlug]
  const derivedDraft = drafts.derived
  const videoDraft = drafts['text-to-video']
  const videoModelId = videoModelIdForDraft(videoDraft)
  const videoModel = selectedCanvasVideoModel(videoConfiguration.models, 'text_to_video', videoModelId)
  const imageVideoModelId = videoModelIdForDraft(derivedDraft?.mode === 'image-to-video' ? derivedDraft : undefined)
  const imageVideoModel = selectedCanvasVideoModel(videoConfiguration.models, 'image_to_video', imageVideoModelId)
  const imageVideoResolution = derivedDraft?.mode === 'image-to-video'
    ? derivedDraft.videoResolution ?? (derivedDraft.resolution === '720p' ? '720p' : imageVideoModel?.resolution) : imageVideoModel?.resolution
  const videoResolution = videoDraft.videoResolution ?? (videoDraft.resolution === '720p' ? '720p' : videoModel?.resolution)
  const selectedVideoReady = videoModelAvailableForMode(videoModel, 'text_to_video')
  const selectedImageVideoReady = videoModelAvailableForMode(imageVideoModel, 'image_to_video')
  const updateDraft = (changes: Partial<GenerationDraft>) => {
    const state = usePersistenceStore.getState()
    // 用户编辑后固定实际模型与档位，刷新时不随默认目录切换供应商。
    state.setDrafts({ ...state.drafts, [activeSlug]: { ...state.drafts[activeSlug],
      ...(activeSlug === 'text-to-video' && videoModel ? { modelProfileId: videoModel.id, videoResolution,
        generateAudio: videoGenerateAudio(videoModel, state.drafts[activeSlug].generateAudio) } : {}), ...changes } })
  }
  const derivedAsset = useEditorStore((state) => derivedDraft ? state.project?.assets[derivedDraft.sourceAssetId] : undefined)
  const derivedContext = derivedDraft && derivedAsset?.type === 'image'
    ? { mode: derivedDraft.mode, source: { node: derivedDraft.sourceNode, asset: derivedAsset } }
    : undefined
  const updateDerived = (changes: Partial<NonNullable<typeof derivedDraft>>) => {
    const state = usePersistenceStore.getState()
    if (state.drafts.derived) state.setDrafts({ ...state.drafts, derived: { ...state.drafts.derived,
      ...(state.drafts.derived.mode === 'image-to-video' && imageVideoModel ? { modelProfileId: imageVideoModel.id,
        videoResolution: imageVideoResolution, generateAudio: videoGenerateAudio(imageVideoModel, state.drafts.derived.generateAudio) } : {}), ...changes } })
  }
  const derivedPrompt = derivedDraft?.prompt ?? ''
  const variationCount = derivedDraft?.count ?? preferences.image.counts.variation
  const derivedDurationSeconds = derivedDraft?.durationSeconds ?? 5
  const stageRef = useRef<FreeCanvasStageHandle>(null)
  const project = useEditorStore((state) => state.project)
  const activeSceneId = useEditorStore((state) => state.activeSceneId)
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined
  const viewport = useEditorStore((state) => state.viewport)
  const canUndo = useEditorStore((state) => state.undoStack.length > 0)
  const canRedo = useEditorStore((state) => state.redoStack.length > 0)
  const selectNodes = useEditorStore((state) => state.selectNodes)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setViewport = useEditorStore((state) => state.setViewport)
  const scene = project?.document.scenes.find((item) => item.id === activeSceneId)
  const generation = useFreeCanvasGenerationController(scene?.id,parseTaskRoute(routeParams.get('task'))?.sourceId)
  const replicationTask = !!generation.task && 'mode' in generation.task.params && generation.task.params.mode === 'video_replication'
  const foreignSubmission = !!generation.pendingSubmission?.ownerId && generation.pendingSubmission.ownerId !== ownerId
  const taskResultCount = generation.task?.resultVideos?.length || generation.task?.resultImages?.length || generation.task?.resultUrls?.length || 0
  const previewAssetIds = Array.from({ length: taskResultCount }, (_, index) => resultAssetForTask(generation.task, index, project?.assets ?? EMPTY_ASSETS)?.id).filter((id): id is string => !!id)
  const images = useCanvasImages(project?.assets ?? EMPTY_ASSETS, scene, derivedDraft?.sourceAssetId,
    replication.productAssetId ? [...previewAssetIds, replication.productAssetId] : previewAssetIds)
  const videos = useCanvasVideos(images.assets, scene)
  const candidateProduct = replication.productAssetId ? images.assets[replication.productAssetId] : undefined
  const product = candidateProduct?.type === 'image' ? candidateProduct : undefined
  const validProduct = !!product && !product.missing && !product.loadError
    && Math.min(product.width, product.height) >= 300 && Math.max(product.width, product.height) <= 6000
    && product.width / product.height >= .4 && product.width / product.height <= 2.5
  const replicationCredits = validProduct && !referenceExpired && referenceQuery.data && !referenceQuery.isError
    ? videoReplicationCredits(replicationPricing, referenceQuery.data.durationSeconds, replication.durationSeconds)
    : undefined
  const selectedVideo = scene?.nodes.find(node => node.id === selectedNodeId && node.type === 'video')
  const selectedVideoAsset = selectedVideo?.type === 'video' ? project?.assets[selectedVideo.assetId] : undefined
  const selectedVideoGeneration = selectedVideoAsset?.generationId ? project?.generations[selectedVideoAsset.generationId] : undefined
  const selectedVideoInput = selectedVideoGeneration?.input
  const selectedReplication = selectedVideoInput && typeof selectedVideoInput === 'object'
    && 'mode' in selectedVideoInput && selectedVideoInput.mode === 'video_replication'
    ? selectedVideoInput as VideoReplicationTaskParams : undefined
  const referenceLabel = usePersistenceStore(state => selectedVideoGeneration?.backendTaskId
    ? Object.values(state.recoveries).find(record => record.backendTaskId === selectedVideoGeneration.backendTaskId)?.context.referenceLabel
    : undefined)
  const replicationInputs = selectedVideoGeneration?.inputAssetIds.map(id => project?.assets[id]) ?? []
  const replicationSourceSummary = selectedReplication
    ? t('replication.sourceSummary', {
      reference: replicationInputs.find(asset => asset?.type === 'video')?.name ?? referenceLabel ?? t('replication.defaultReferenceName'),
      product: replicationInputs.find(asset => asset?.type === 'image')?.name ?? t('replication.defaultProductName'),
    })
    : undefined
  const model = matchImageModel(configuration.models, derivedDraft?.modelProfileId)
    ?? configuration.models.find(item => item.defaultFor?.includes('variation')) ?? configuration.models[0]
  const requestedResolution = derivedDraft?.resolution && derivedDraft.resolution !== '720p' ? derivedDraft.resolution : preferences.image.resolution
  const effective = effectiveImageParameters(variationCount, requestedResolution, derivedAsset?.type === 'image' ? derivedAsset : undefined, model?.ui)
  const estimatedCredits = imageCreditAmount(model, effective.count, effective.resolution)
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

  const importPicture = async (
    input: File | WorkstationHistoryListItem,
    options?: { center?: { x: number; y: number }; reveal?: boolean; keepPickerOpen?: boolean },
  ) => {
    if (importGate.current || !project || !scene) return undefined
    // 选图时先做同步体积检查，避免已经进入导入流程、看到转圈后才报错。
    if (input instanceof File) {
      const invalid = imageFileError(input)
      if (invalid) { message.error(invalid); return undefined }
    }
    importGate.current = true
    setImporting(true)
    const context: CanvasImageImportContext = {
      ownerId, projectId: project.id, sceneId: scene.id, epoch, signal: importAbort.current.signal,
      center: options?.center ?? stageRef.current?.getViewportCenter() ?? { x: scene.width / 2, y: scene.height / 2 },
    }
    try {
      const imported = input instanceof File ? await importCanvasFile(input, context) : await importCanvasHistory(input, context)
      if (!context.signal.aborted) {
        if (options?.reveal !== false) stageRef.current?.revealBounds([calculateNodeBounds(imported.node)])
        if (!options?.keepPickerOpen) setPickerOpen(false)
        await flushProject()
      }
      return context.signal.aborted ? undefined : imported.node
    } catch (error) {
      if (!context.signal.aborted) message.error(error instanceof Error ? error.message : t('errors.addImageFailed'))
      return undefined
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
    if (task && generation.formLocked) {
      if (!replicationTask && derivedDraft) return
      const target = replicationTask ? VIDEO_REPLICATION_MODE.slug : task.capability === Capability.TextToVideo ? 'text-to-video' : 'text-to-image'
      const current = replicationTab ? VIDEO_REPLICATION_MODE.slug : activeSlug
      if (current !== target) navigate(`/canvas/${target}${window.location.search}`, { replace: true })
    }
  }, [activeSlug, replicationTab, replicationTask, derivedDraft, generation.formLocked, generation.task, navigate])

  /** 从系统拖入的图片：逐张串行导入，落点是鼠标位置，全部完成后一起选中。 */
  const handleFilesDropped = async (files: File[], center: { x: number; y: number }) => {
    if (!project || !scene || generation.formLocked) return
    const accepted: File[] = []
    let rejected = 0
    for (const file of files) {
      if (imageFileError(file)) rejected += 1
      else accepted.push(file)
    }
    if (!accepted.length) {
      message.warning(t('errors.supportedImageTypes'))
      return
    }
    const importedNodes: EditorNode[] = []
    for (const file of accepted) {
      const node = await importPicture(file, { center, reveal: false, keepPickerOpen: true })
      if (node) importedNodes.push(node)
    }
    if (importedNodes.length) {
      selectNodes(importedNodes.map((node) => node.id))
      stageRef.current?.revealBounds(importedNodes.map((node) => calculateNodeBounds(node)))
    }
    if (rejected) message.warning(t('errors.partialImportUnsupported', { added: importedNodes.length, rejected }))
  }

  // 方向键微调：按下时直接改坐标（实时反馈），停顿 400ms 或失焦时提交为一条撤销记录。
  const nudgeSession = useRef<{ start: Map<string, EditorNode> } | null>(null)
  const nudgeTimer = useRef<number>()

  const flushNudge = useCallback(() => {
    const session = nudgeSession.current
    if (!session) return
    nudgeSession.current = null
    if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
    nudgeTimer.current = undefined
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId
    const currentScene = state.project?.document.scenes.find((item) => item.id === sceneId)
    if (!sceneId || !currentScene) return
    const commands = [...session.start.entries()].flatMap(([id, start]) => {
      const node = currentScene.nodes.find((item) => item.id === id)
      if (!node || (node.x === start.x && node.y === start.y)) return []
      return [new UpdateNodeCommand(sceneId, id, { x: node.x, y: node.y }, start)]
    })
    if (!commands.length) return
    state.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand(sceneId, commands))
    void flushProject().catch(() => undefined)
  }, [])

  const nudgeBy = useCallback((dx: number, dy: number) => {
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId
    const currentScene = state.project?.document.scenes.find((item) => item.id === sceneId)
    if (!sceneId || !currentScene || !state.selectedNodeIds.length) return
    const targets = state.selectedNodeIds
      .map((id) => currentScene.nodes.find((node) => node.id === id))
      .filter((node): node is EditorNode => !!node)
    if (!targets.length) return
    nudgeSession.current = nudgeSession.current ?? { start: new Map(targets.map((node) => [node.id, node] as const)) }
    if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
    nudgeTimer.current = window.setTimeout(() => flushNudge(), 400)
    for (const node of targets) state.updateNode(sceneId, node.id, { x: node.x + dx, y: node.y + dy })
  }, [flushNudge])

  const selectAllNodes = useCallback(() => {
    const state = useEditorStore.getState()
    const currentScene = state.project?.document.scenes.find((item) => item.id === state.activeSceneId)
    if (!currentScene) return
    selectNodes(currentScene.nodes.map((node) => node.id))
  }, [selectNodes])

  useEffect(() => () => { flushNudge() }, [flushNudge])

  const handleSelectNodes = useCallback((nodeIds: string[]) => {
    selectNodes(nodeIds)
  }, [selectNodes])

  const handleTransformNodes = useCallback((updates: NodeTransformUpdate[]) => {
    if (!updates.length) return
    flushNudge()
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId
    if (!sceneId) return
    const commands = updates.map((update) => new UpdateNodeCommand(sceneId, update.id, update.transform))
    state.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand(sceneId, commands))
  }, [flushNudge])

  const handleDeleteSelection = useCallback(() => {
    flushNudge()
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId
    const ids = state.selectedNodeIds
    if (!sceneId || !ids.length) return
    const currentScene = state.project?.document.scenes.find((item) => item.id === sceneId)
    if (!currentScene) return
    const targets = ids
      .map((id) => currentScene.nodes.find((node) => node.id === id))
      .filter((node): node is EditorNode => !!node)
    if (!targets.length || targets.some((node) => !isTerminalGeneration(node, state.project))) return

    const persistence = usePersistenceStore.getState()
    for (const targetNode of targets) {
      if (targetNode.type !== 'generation') continue
      const job = state.project?.generations[targetNode.generationId]
      for (const rec of Object.values(persistence.recoveries)) {
        if (rec.abandoned || rec.applied) continue
        if ((rec.backendTaskId && generationIdForTask(rec.backendTaskId) === targetNode.generationId)
            || (job?.backendTaskId && rec.backendTaskId === job.backendTaskId)) {
          persistence.setRecovery({ ...rec, abandoned: true })
        }
      }
      if (generation.task && (generationIdForTask(generation.task.id) === targetNode.generationId || generation.task.id === job?.backendTaskId)) {
        generation.dismissTask()
      }
    }
    const currentDraft = persistence.drafts.derived
    if (currentDraft && targets.some((node) => node.id === currentDraft.sourceNode.id
      || (node.type === 'image' && currentDraft.sourceAssetId === node.assetId))) {
      usePersistenceStore.getState().setDrafts({ ...persistence.drafts, derived: undefined })
    }
    const commands = targets.map((node) => new RemoveNodeCommand(sceneId, node.id))
    state.executeCommand(commands.length === 1 ? commands[0] : new CompositeCommand(sceneId, commands))
    void flushProject().catch(() => undefined)
  }, [flushNudge, generation])

  const handleDuplicateSelection = useCallback(() => {
    flushNudge()
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId
    const currentScene = state.project?.document.scenes.find((item) => item.id === sceneId)
    if (!sceneId || !currentScene) return
    const selection = new Set(state.selectedNodeIds)
    // 资产不可变可复用：复制节点不扣积分、不新增素材；生成中的占位框不参与复制。
    const sources = currentScene.nodes.filter((node) => selection.has(node.id) && (node.type === 'image' || node.type === 'video'))
    if (!sources.length) return
    const occupied = currentScene.nodes.map((node) => calculateNodeBounds(node))
    let zIndex = nextZIndex(currentScene.nodes)
    // 复制保留原始尺寸：只做级联偏移避让，不为了塞进画板而缩小副本。
    const clones: EditorNode[] = sources.map((node) => {
      const placed = offsetPlacementToAvoidOverlap(
        { x: node.x + NODE_CASCADE_OFFSET, y: node.y + NODE_CASCADE_OFFSET, width: node.width, height: node.height },
        occupied,
        { offset: NODE_CASCADE_OFFSET },
      )
      occupied.push(boundsFromPlacement(placed))
      return {
        ...node,
        id: crypto.randomUUID(),
        x: placed.x,
        y: placed.y,
        zIndex: zIndex++,
      }
    })
    state.executeCommand(new CompositeCommand(sceneId, clones.map((node) => new AddNodeCommand(sceneId, node))))
    state.selectNodes(clones.map((node) => node.id))
    void flushProject().catch(() => undefined)
  }, [flushNudge])

  /** 空状态里的示例描述：写进当前模式的草稿，并把焦点放到描述框。 */
  const focusCanvasPrompt = useCallback(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-canvas-prompt]')
    if (!textarea) return
    textarea.focus({ preventScroll: true })
    textarea.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const handleUseExamplePrompt = useCallback((example: string) => {
    // 只写描述，不动模型/分辨率——示例不该顺带改变用户的参数选择。
    const persistence = usePersistenceStore.getState()
    persistence.setDrafts({
      ...persistence.drafts,
      [activeSlug]: { ...persistence.drafts[activeSlug], prompt: example },
    })
    focusCanvasPrompt()
  }, [activeSlug, focusCanvasPrompt])

  const handleCopySelection = useCallback(() => {
    const state = useEditorStore.getState()
    const project = state.project
    const currentScene = project?.document.scenes.find((item) => item.id === state.activeSceneId)
    if (!project || !currentScene) return
    const selection = new Set(state.selectedNodeIds)
    const nodes = currentScene.nodes.filter((node) => selection.has(node.id))
    if (!nodes.length) return
    const copied = copyNodesToClipboard(project.id, nodes)
    if (!copied) {
      message.warning(i18n.t('canvas:errors.cannotCopyActivePlaceholder'))
      return
    }
    message.success({ content: i18n.t('canvas:page.copiedItems', { count: copied }), duration: 1.2 })
  }, [message])

  const handlePaste = useCallback(() => {
    const state = useEditorStore.getState()
    const project = state.project
    const currentScene = project?.document.scenes.find((item) => item.id === state.activeSceneId)
    if (!project || !currentScene) return
    const clipboard = readClipboard(project.id)
    if (!clipboard) {
      message.info(i18n.t('canvas:page.clipboardEmpty'))
      return
    }
    const nodes = buildPastedNodes({ scene: currentScene, clipboard, pointer: stageRef.current?.getPointerCanvasPoint() })
    if (!nodes.length) return
    state.executeCommand(new CompositeCommand(
      currentScene.id,
      nodes.map((node) => new AddNodeCommand(currentScene.id, node)),
    ))
    state.selectNodes(nodes.map((node) => node.id))
    void flushProject().catch(() => undefined)
  }, [message])

  const handleReorderSelection = useCallback((action: ZOrderAction) => {
    flushNudge()
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId
    const currentScene = state.project?.document.scenes.find((item) => item.id === sceneId)
    if (!sceneId || !currentScene) return
    const changes = reorderZIndex(currentScene.nodes, state.selectedNodeIds, action)
    if (!changes) return
    state.executeCommand(new CompositeCommand(
      sceneId,
      changes.map((change) => new UpdateNodeCommand(sceneId, change.id, { zIndex: change.zIndex })),
    ))
    void flushProject().catch(() => undefined)
  }, [flushNudge])


  const handleRemoveBrokenImages = useCallback(() => {
    const state = useEditorStore.getState()
    if (!state.activeSceneId) return
    const currentScene = state.project?.document.scenes.find((item) => item.id === state.activeSceneId)
    if (!currentScene) return

    const brokenAssetIdSet = new Set(images.brokenAssetIds)
    const brokenNodes = currentScene.nodes.filter(node =>
      node.type === 'image' && (
        brokenAssetIdSet.has(node.assetId) ||
        images.assets[node.assetId]?.loadError ||
        images.assets[node.assetId]?.missing
      )
    )

    if (brokenNodes.length === 0) return

    for (const node of brokenNodes) {
      state.executeCommand(new RemoveNodeCommand(state.activeSceneId, node.id))
    }

    const currentDraft = usePersistenceStore.getState().drafts.derived
    if (currentDraft && (brokenNodes.some(n => n.id === currentDraft.sourceNode.id) || brokenAssetIdSet.has(currentDraft.sourceAssetId))) {
      usePersistenceStore.getState().setDrafts({ ...usePersistenceStore.getState().drafts, derived: undefined })
    }

    void flushProject().catch(() => undefined)
    message.success(i18n.t('canvas:page.removedBrokenImages', { count: brokenNodes.length }))
  }, [images.brokenAssetIds, images.assets, message])

  const updateReplication = (changes: Partial<VideoReplicationDraft>) => {
    const state = usePersistenceStore.getState()
    if (!state.writable || state.cloud || state.epoch !== epoch || !isCurrentWorkstationHistoryOwner(ownerId)) return
    const current = state.drafts.videoReplication
    state.setDrafts({ ...state.drafts, videoReplication: { ...(current?.ownerId === ownerId ? current : defaultReplication), ...changes } })
  }

  const openReplication = () => {
    if (!replicationTab) navigate(`/canvas/${VIDEO_REPLICATION_MODE.slug}${window.location.search}`)
  }

  const selectReference = async (
    source: File | { key: string; name: string; assetId?: string },
    previous?: Pick<VideoReplicationDraft, 'prompt' | 'durationSeconds' | 'ratio' | 'productAssetId'>,
  ) => {
    if (!replicationPricing || cloudProject || !writable || generation.formLocked || referenceGate.current || !project || !scene) return
    referenceGate.current = true
    setReferenceBusy(true)
    setReferenceError(undefined)
    const signal = importAbort.current.signal
    const isCurrent = () => !signal.aborted && isCurrentWorkstationHistoryOwner(ownerId)
      && usePersistenceStore.getState().epoch === epoch && useEditorStore.getState().activeSceneId === scene.id
    generation.dismissTask()
    try {
      const { url, ...reference } = source instanceof File
        ? await uploadVideoReference(source, signal)
        : await inspectVideoReference(source.key, signal)
      if (!isCurrent()) return
      queryClient.setQueryData(['canvas-video-reference', ownerId, reference.key], { ...reference, url })
      updateReplication({ reference: { ...reference, name: source.name, ...(source instanceof File ? {} : { assetId: source.assetId }) },
        ...(previous ?? videoReplicationDefaults(reference)) })
      if (!replicationTab) {
        await flushProject()
        if (isCurrent()) openReplication()
      }
    } catch (error) {
      if (isCurrent()) {
        if (previous) updateReplication({ ...previous, reference: undefined })
        const text = error instanceof Error ? error.message : t('errors.readReferenceFailed')
        if (replicationTab) setReferenceError(text)
        else message.error(text)
      }
    } finally {
      referenceGate.current = false
      setReferenceBusy(false)
    }
  }

  const selectCanvasReference = (assetId: string) => {
    const asset = project?.assets[assetId]
    const key = asset?.type === 'video' ? asset.objectKey ?? asset.storage?.objectKey : undefined
    if (!asset || !key) { message.info(t('errors.referenceUnavailable')); return }
    void selectReference({ key, name: asset.name, assetId })
  }

  const handleVideoReferenceNode = (nodeId: string) => {
    const node = scene?.nodes.find(item => item.id === nodeId)
    if (node?.type === 'video') selectCanvasReference(node.assetId)
  }

  const reuseReplication = () => {
    if (!selectedReplication) return
    const reference = replicationInputs.find(asset => asset?.type === 'video')
    const product = replicationInputs.find(asset => asset?.type === 'image')
    void selectReference({ key: selectedReplication.referenceVideoKey, name: reference?.name ?? referenceLabel ?? t('replication.defaultOriginalReferenceName'), assetId: reference?.id }, {
      prompt: selectedReplication.prompt, ratio: selectedReplication.ratio, durationSeconds: selectedReplication.durationSeconds, productAssetId: product?.id,
    })
  }

  const submitReplication = () => {
    if (!replicationPricing || !replication.reference || !product || !replicationCredits || !scene
      || !referenceQuery.data || referenceQuery.isError || generation.formLocked
      || Date.parse(replication.reference.retentionExpiresAt) <= Date.now()) return
    const request = buildVideoReplicationRequest(replication.reference.key, replication.prompt, replication.ratio,
      replication.durationSeconds, replicationPricing.version)
    const center = stageRef.current?.getViewportCenter() ?? { x: scene.width / 2, y: scene.height / 2 }
    const referenceAssetId = replication.reference.assetId
    const inputs = [product.id, ...(referenceAssetId && project?.assets[referenceAssetId] ? [referenceAssetId] : [])]
    void generation.generate(request, center, { inputAssetIds: inputs, referenceLabel: replication.reference.name }).then(placements => {
      if (placements?.length) stageRef.current?.revealBounds(placements.map(boundsFromPlacement))
    })
  }

  const handleGenerate = () => {
    if (activeSlug === 'text-to-video' && (!videoConfiguration.ready || !selectedVideoReady || cloudProject)) {
      message.warning(!videoConfiguration.ready ? t('stage.imageActions.videoUnavailable', { status: capabilityAvailabilityLabel(videoConfiguration.textState) })
        : !selectedVideoReady ? t('video.settings.modelUnavailableNotice') : t('generation.saveLocalCopyForVideo'))
      return
    }
    if (activeSlug === 'text-to-image' && !textToImageEntryEnabled) {
      message.warning(t('errors.checkTextToImageConfig'))
      return
    }
    const promptMaxLength = textToImageParameters.model?.ui.promptMaxLength
    if (activeSlug === 'text-to-image' && promptMaxLength && prompt.trim().length > promptMaxLength) {
      message.warning(t('errors.promptMaxLength', { max: promptMaxLength }))
      return
    }
    const preset = IMAGE_SIZE_PRESETS.find((item) => item.key === presetKey) ?? IMAGE_SIZE_PRESETS[0]
    if (activeSlug === 'text-to-video' && videoModel?.ratios?.length && !videoModel.ratios.some((ratio) => ratio === preset.key)) {
      message.warning(t('errors.unsupportedVideoRatio'))
      return
    }
    const center = stageRef.current?.getViewportCenter() ?? {
      x: scene?.width ? scene.width / 2 : 0,
      y: scene?.height ? scene.height / 2 : 0,
    }
    try {
      const request = activeSlug === 'text-to-video'
        ? buildTextToVideoRequest(prompt, preset, durationSeconds, videoModel ? { model: videoModel, generateAudio: drafts['text-to-video'].generateAudio ?? false, resolution: videoResolution } : undefined)
        : buildTextToImageRequest(prompt, textToImageParameters.preset, textToImageParameters.count, {
            resolution: textToImageParameters.resolution,
            modelProfileId: textToImageParameters.model?.id,
            ...(textToImageParameters.model?.provider === 'bailian'
              ? { enableThinking: drafts['text-to-image'].enableThinking === true }
              : {}),
          })
      if (activeSlug === 'text-to-image') {
        updateDraft({ modelProfileId: textToImageParameters.model?.id, resolution: textToImageParameters.requestedResolution })
      } else {
        updateDraft({ modelProfileId: videoModel?.id, videoResolution })
      }
      void generation.generate(request, center).then((placements) => {
        if (!placements?.length) return
        stageRef.current?.revealBounds(placements.map(boundsFromPlacement))
      })
    } catch (error) { message.error(error instanceof Error ? error.message : t('errors.invalidGenerationParams')) }
  }

  const variationModelId = model?.id
  const handleNodeGenerationAction = (action: DerivedGenerationMode, nodeId: string) => {
    if (action === 'image-to-video' && !videoConfiguration.imageReady) {
      message.warning(t('stage.imageActions.videoUnavailable', { status: capabilityAvailabilityLabel(videoConfiguration.imageState) }))
      return
    }
    if (action === 'variation' && !isFreeCanvasVariationEntryEnabled() && !configuration.loading) {
      message.warning(t('errors.checkVariationConfig'))
      return
    }
    const state = useEditorStore.getState()
    const currentScene = state.project?.document.scenes.find((item) => item.id === state.activeSceneId)
    const node = currentScene?.nodes.find((item) => item.id === nodeId)
    const asset = node?.type === 'image' ? state.project?.assets[node.assetId] : undefined
    if (!node || node.type !== 'image' || !asset || asset.type !== 'image') {
      message.error({ content: t('errors.sourceImageCannotDerive'), duration: 4 })
      return
    }
    generation.dismissTask()
    const persistence = usePersistenceStore.getState()
    const current = persistence.drafts.derived
    const previous = current?.mode === action && current.sourceAssetId === asset.id ? current : undefined
    const selectedVideo = selectedCanvasVideoModel(videoConfiguration.models, 'image_to_video', videoModelIdForDraft(previous))
    persistence.setDrafts({ ...persistence.drafts, derived: {
      mode: action, sourceNode: { ...node }, sourceAssetId: asset.id, prompt: '',
      count: previous?.count ?? preferences.image.counts.variation, durationSeconds: previous?.durationSeconds ?? 5,
      resolution: action === 'image-to-video' ? undefined : previous?.resolution && previous.resolution !== '720p' ? previous.resolution : preferences.image.resolution,
      videoResolution: action === 'image-to-video' ? previous?.videoResolution ?? (previous?.resolution === '720p' ? '720p' : selectedVideo?.resolution) : undefined,
      modelProfileId: action === 'image-to-video' ? selectedVideo?.id : previous?.modelProfileId ?? variationModelId,
      generateAudio: action === 'image-to-video' ? videoGenerateAudio(selectedVideo, previous?.generateAudio) : previous?.generateAudio,
    } })
  }

  const variationEntryEnabled = isFreeCanvasVariationEntryEnabled()
  const handleDerivedGenerate = () => {
    const selected = resolveSelectedImageSource(scene, project?.assets, selectedNodeId)
    const source = selected ?? derivedContext?.source
    if (!derivedContext || !source) return
    if (derivedContext.mode === 'image-to-video' && (!videoConfiguration.imageReady || !selectedImageVideoReady || cloudProject)) {
      message.warning(!videoConfiguration.imageReady ? t('stage.imageActions.videoUnavailable', { status: capabilityAvailabilityLabel(videoConfiguration.imageState) })
        : !selectedImageVideoReady ? t('video.settings.modelUnavailableNotice') : t('generation.saveLocalCopyForVideo'))
      return
    }
    if (derivedContext.mode === 'variation' && (!variationEntryEnabled || (!mockGateway && estimatedCredits === undefined))) {
      message.warning(t('errors.checkVariationConfig'))
      return
    }
    try {
      const request = derivedContext.mode === 'variation'
        ? buildVariationRequest(source.asset, derivedPrompt, effective.count, { resolution: effective.resolution, modelProfileId: model?.id })
        : buildImageToVideoRequest(source.asset, derivedPrompt, derivedDurationSeconds, imageVideoModel ? { model: imageVideoModel, generateAudio: derivedDraft?.generateAudio ?? false, resolution: imageVideoResolution } : undefined)
      if (derivedContext.mode === 'variation') updateDerived({ count: effective.count, resolution: effective.resolution, modelProfileId: model?.id, sourceNode: { ...source.node }, sourceAssetId: source.asset.id })
      else updateDerived({ modelProfileId: imageVideoModel?.id, videoResolution: imageVideoResolution, sourceNode: { ...source.node }, sourceAssetId: source.asset.id })
      void generation.generateDerived(request, source).then((placements) => {
        if (!placements?.length) return
        stageRef.current?.revealBounds([calculateNodeBounds(source.node), ...placements.map(boundsFromPlacement)])
      })
    } catch (error) { message.error(error instanceof Error ? error.message : t('errors.invalidGenerationParams')) }
  }

  const handleCloseDerived = () => {
    generation.dismissTask()
    const persistence = usePersistenceStore.getState()
    persistence.setDrafts({ ...persistence.drafts, derived: undefined })
  }

  const handleAssetLoadError = useCallback((content: string) => {
    message.error({ content, duration: 4 })
  }, [message])

  const selectedNodes = (scene?.nodes ?? []).filter((node) => selectedNodeIds.includes(node.id))
  const pendingPlaceholders = selectedNodes.filter((node) => !isTerminalGeneration(node, project))
  const deletableSelection = pendingPlaceholders.length === 0
  const duplicableSelection = deletableSelection && selectedNodes.some((node) => node.type === 'image' || node.type === 'video')
  const selectionBlockedReason = pendingPlaceholders.length
    ? t('page.selectionBlockedReason', { count: pendingPlaceholders.length })
    : undefined

  const reloadModelConfiguration = () => {
    void configuration.reload()
    void textToImageConfiguration.reload()
    void videoConfiguration.reload()
  }

  // 状态提示按"阻塞 > 媒体 > 配置 > 信息"排优先级；默认只露出第一条，其余折叠。
  const notices: CanvasNotice[] = []
  if (generation.pendingSubmission && !generation.submitting) {
    notices.push({
      key: 'pending-submission',
      level: 'warning',
      message: foreignSubmission ? t('notices.foreignSubmissionTitle') : t('notices.pendingSubmissionTitle'),
      description: foreignSubmission
        ? t('notices.foreignSubmissionDesc')
        : t('notices.pendingSubmissionDesc'),
      actions: [
        ...(!foreignSubmission ? [{ key: 'resume', label: t('notices.resumeRequest'), onClick: () => { void generation.resumeSubmission() } }] : []),
        { key: 'abandon', label: t('notices.abandonWait'), onClick: generation.abandonSubmission },
      ],
    })
  }
  if (generation.pollError) {
    notices.push({
      key: 'poll-error',
      level: 'warning',
      message: t('notices.pollErrorTitle'),
      description: generation.pollError.message,
      actions: [{ key: 'modify', label: t('notices.abandonAndModify'), onClick: generation.modifyParameters }],
    })
  }
  if (images.error) {
    notices.push({
      key: 'images-error',
      level: 'warning',
      message: t('notices.imagesErrorTitle'),
      description: images.error,
      actions: [
        { key: 'reload', label: t('notices.reload'), onClick: images.reload },
        { key: 'clean', label: t('notices.cleanBrokenImages'), onClick: handleRemoveBrokenImages, danger: true },
      ],
    })
  }
  if (videos.error) {
    notices.push({
      key: 'videos-error',
      level: 'warning',
      message: t('notices.videosErrorTitle'),
      description: videos.error,
      actions: [{ key: 'reload', label: t('notices.retryLoadVideos'), onClick: videos.reload }],
    })
  }
  if (configuration.error || textToImageConfiguration.error) {
    const detail = [
      configuration.error ? t('notices.variationErrorPrefix', { error: configuration.error }) : '',
      textToImageConfiguration.error ? t('notices.textToImageErrorPrefix', { error: textToImageConfiguration.error }) : '',
    ].filter(Boolean).join(t('common.semicolon'))
    notices.push({
      key: 'model-config',
      level: 'warning',
      message: t('notices.modelConfigTitle'),
      description: detail,
      actions: [{ key: 'reload', label: t('notices.reloadModelConfig'), onClick: reloadModelConfiguration }],
    })
  }
  if (cloudProject && ((activeSlug === 'text-to-video' && videoConfiguration.ready) || (derivedContext?.mode === 'image-to-video' && videoConfiguration.imageReady))) {
    notices.push({
      key: 'cloud-video',
      level: 'info',
      message: t('notices.cloudVideoTitle'),
      description: t('notices.cloudVideoDesc'),
      actions: [{
        key: 'copy-local',
        label: t('notices.saveLocalCopy'),
        disabled: generation.formLocked,
        onClick: () => { void copyProjectLocally().catch(error => message.error(error instanceof Error ? error.message : t('errors.saveLocalCopyFailed'))) },
      }],
    })
  }

  const cloudBusy = useCloudStore((state) => state.busy || state.interacting)
  const actionsBlocked = importing || generation.submitting || generation.active || !!generation.pendingSubmission
  useEffect(() => {
    useCanvasActionGate.setState({ blocked: actionsBlocked })
    return () => useCanvasActionGate.setState({ blocked: false })
  }, [actionsBlocked])

  const [canvasFocused, setCanvasFocused] = useState(false)
  const shortcutRef = useRef<(event: KeyboardEvent) => void>(() => {})

  const handleShortcut = (event: KeyboardEvent) => {
    if (isEditingText(event.target)) return
    const commandKey = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (commandKey && key === 'z') {
      event.preventDefault()
      flushNudge()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (event.ctrlKey && key === 'y') { event.preventDefault(); flushNudge(); redo(); return }
    if (commandKey && key === 'd') { event.preventDefault(); handleDuplicateSelection(); return }
    if (commandKey && key === 'c') {
      // 页面上选中了文本时让浏览器自己复制，别抢快捷键。
      if (window.getSelection()?.toString()) return
      event.preventDefault()
      handleCopySelection()
      return
    }
    if (commandKey && key === 'v') {
      const project = useEditorStore.getState().project
      if (!project || !readClipboard(project.id)) return
      event.preventDefault()
      flushNudge()
      handlePaste()
      return
    }
    if (commandKey && key === 'a') { event.preventDefault(); flushNudge(); selectAllNodes(); return }
    if (commandKey && (event.key === ']' || event.key === '[')) {
      event.preventDefault()
      handleReorderSelection(event.key === ']'
        ? (event.shiftKey ? 'front' : 'forward')
        : (event.shiftKey ? 'back' : 'backward'))
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      handleDeleteSelection()
      return
    }
    if (event.key === 'Escape') {
      flushNudge()
      if (derivedContext) handleCloseDerived()
      else selectNodes([])
      return
    }
    if (!canvasFocused) return
    // 刻意避开浏览器保留键（⌘0/⌘1 切标签页），用 ⇧0/⇧1。
    if (event.shiftKey && !commandKey && event.code === 'Digit0') { event.preventDefault(); stageRef.current?.zoomTo(1); return }
    if (event.shiftKey && !commandKey && event.code === 'Digit1') { event.preventDefault(); stageRef.current?.fitToScene(); return }
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft') { event.preventDefault(); nudgeBy(-step, 0) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); nudgeBy(step, 0) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); nudgeBy(0, -step) }
    else if (event.key === 'ArrowDown') { event.preventDefault(); nudgeBy(0, step) }
  }

  useEffect(() => { shortcutRef.current = handleShortcut })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcutRef.current(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (!project || !scene) {
    return <div className="free-canvas-loading">{t('page.loading')}</div>
  }

  return (
    <div className="free-canvas-page">
      <CanvasTaskRecovery onTaskObserved={generation.observeRecoveredTask}/>
      <CloudToolbar disabled={actionsBlocked || cloudBusy || hasUnfinishedGeneration()} onUploadImage={() => fileInput.current?.click()} />
      {pickerOpen && <CanvasAssetPicker key={ownerId} ownerId={ownerId} busy={importing} onSelect={async (record) => { await importPicture(record) }} onClose={() => { if (!importing) setPickerOpen(false) }} />}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={t('page.uploadInputAria')} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void importPicture(file)
      }} />
      <CanvasNoticeBar notices={notices} />
      <div className="free-canvas-page-header page-tab-row">
        <Segmented
          // 能力不可用不再做成禁用页签（禁用态文字读不清，且点不进去看不到原因）：
          // 页签照常可切，落地后用 VideoAvailabilityNotice 说明原因并提供重试。
          options={[...CANVAS_MODES, ...(replicationPricing || replicationTab ? [VIDEO_REPLICATION_MODE] : [])]
            .map((item) => ({ label: canvasModeLabel(item.slug), value: item.slug }))}
          value={replicationTab ? VIDEO_REPLICATION_MODE.slug : activeSlug}
          onChange={(value) => {
            if (replicationTab && !generation.formLocked) generation.dismissTask()
            navigate(`/canvas/${value}`)
          }}
        />
      </div>
      <div className="free-canvas-workspace">
        <FreeCanvasStage
          key={scene.id}
          ref={stageRef}
          scene={scene}
          assets={videos.assets}
          generations={project.generations}
          selectedNodeIds={selectedNodeIds}
          viewport={viewport}
          canUndo={canUndo}
          canRedo={canRedo}
          generationActive={generation.formLocked}
          canDeleteSelection={deletableSelection}
          canDuplicateSelection={duplicableSelection}
          selectionBlockedReason={selectionBlockedReason}
          taskPhase={generation.task?.phase
            ? { generationId: generationIdForTask(generation.task.id), phase: generation.task.phase }
            : undefined}
          onSelectNodes={handleSelectNodes}
          onTransformNodes={handleTransformNodes}
          onViewportChange={setViewport}
          onUndo={undo}
          onRedo={redo}
          onDeleteSelection={handleDeleteSelection}
          onDuplicateSelection={handleDuplicateSelection}
          onReorderSelection={handleReorderSelection}
          onFilesDropped={handleFilesDropped}
          onCanvasFocusChange={setCanvasFocused}
          emptyState={!replicationTab && <CanvasEmptyState
            mode={activeSlug === 'text-to-video' ? 'video' : 'image'}
            onUsePrompt={handleUseExamplePrompt}
            onFocusPrompt={focusCanvasPrompt}
            onPickAsset={() => setPickerOpen(true)}
          />}
          variationEnabled={variationEntryEnabled || configuration.loading}
          imageToVideoEnabled={videoConfiguration.imageReady}
          imageToVideoState={videoConfiguration.imageState}
          onNodeGenerationAction={handleNodeGenerationAction}
          onUseVideoReference={replicationPricing && !cloudProject && writable ? handleVideoReferenceNode : undefined}
          onReuseVideoReplication={replicationPricing && !cloudProject && writable && selectedReplication ? reuseReplication : undefined}
          replicationSourceSummary={replicationSourceSummary}
          onAssetLoadError={handleAssetLoadError}
        >
          <CanvasAddImageButton
            importing={importing}
            disabled={generation.submitting || !!generation.pendingSubmission}
            onUpload={() => fileInput.current?.click()}
            onPickAsset={() => setPickerOpen(true)}
          />
        </FreeCanvasStage>
        {replicationTab ? (
          <VideoReplicationPanel draft={replication} status={generation} available={!!replicationPricing} cloud={!!cloudProject}
            locked={generation.formLocked || !writable} busy={referenceBusy || importing} error={referenceError}
            preview={referenceQuery.isError ? undefined : referenceQuery.data?.url}
            referenceExpired={referenceExpired} previewError={referenceQuery.error instanceof Error ? referenceQuery.error.message : undefined}
            product={product} invalidProduct={!!product && !validProduct} credits={replicationCredits} balance={balance}
            referenceChoices={Object.values(videos.assets).filter((asset): asset is VideoAsset => asset.type === 'video'
              && Boolean(asset.objectKey ?? asset.storage?.objectKey) && (!asset.retentionExpiresAt || Date.parse(asset.retentionExpiresAt) > referenceClock))}
            productChoices={Object.values(images.assets).filter((asset): asset is ImageAsset => asset.type === 'image')}
            sourceSummary={replicationSourceSummary}
            onChange={updateReplication} onSelectVideo={selectCanvasReference} onUploadVideo={file => { void selectReference(file) }}
            onUploadImage={file => { void importPicture(file).then(node => { if (node) updateReplication({ productAssetId: node.assetId }) }) }}
            onReload={videoConfiguration.reload} onGenerate={submitReplication} />
        ) : derivedContext ? (
          <DerivedGenerationPanel
            mode={derivedContext.mode}
            sourceAsset={images.assets[derivedContext.source.asset.id] as typeof derivedContext.source.asset}
            prompt={derivedPrompt}
            count={derivedContext.mode === 'variation' ? effective.count : variationCount}
            durationSeconds={derivedDurationSeconds}
            generateAudio={derivedDraft?.generateAudio ?? false}
            onAudioChange={generateAudio => updateDerived({ generateAudio })}
            videoConfigured={videoConfiguration.imageReady}
            videoModel={imageVideoModel}
            videoModels={videoConfiguration.models.filter(item => videoModelModes(item).includes('image_to_video'))}
            selectedVideoModelId={imageVideoModelId}
            videoResolution={imageVideoResolution}
            onVideoModelChange={modelProfileId => {
              const selected = videoConfiguration.models.find(item => item.id === modelProfileId)
              updateDerived({ modelProfileId, videoResolution: selected?.resolution, resolution: undefined,
                generateAudio: videoGenerateAudio(selected, derivedDraft?.generateAudio) })
            }}
            onVideoResolutionChange={videoResolution => updateDerived({ videoResolution })}
            videoAvailability={videoConfiguration.imageState}
            onReloadModels={derivedContext.mode === 'variation' ? configuration.reload : videoConfiguration.reload}
            task={replicationTask ? undefined : generation.task}
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
            generateDisabled={derivedContext.mode === 'variation' ? !variationEntryEnabled || (!mockGateway && estimatedCredits === undefined) : !videoConfiguration.imageReady || !selectedImageVideoReady || !!cloudProject}
            modelsLoading={derivedContext.mode === 'variation' ? configuration.loading : videoConfiguration.imageState === 'loading'}
            onGenerate={handleDerivedGenerate}
            onRetry={() => { void generation.retry() }}
            onModifyParameters={generation.modifyParameters}
            onRefetch={() => { void generation.refetch() }}
            models={configuration.models}
            modelProfileId={model?.id}
            resolution={effective.resolution}
            onModelChange={modelProfileId => updateDerived({ modelProfileId })}
            onResolutionChange={resolution => updateDerived({ resolution })}
            estimatedCredits={derivedContext.mode === 'variation' ? estimatedCredits : videoCreditsForDuration(selectedImageVideoReady ? imageVideoModel : undefined, derivedDurationSeconds, imageVideoResolution)}
            resolutionAdjusted={effective.resolution !== requestedResolution}
            mockGateway={mockGateway}
            preparationPhase={generation.preparationPhase}
            historyError={generation.historyError}
            historySaved={generation.historySaved}
            onRetrySave={generation.retryHistory}
            resultAssets={videos.assets}
          />
        ) : selectedNodes.length > 1 ? (
          <SelectionSummary
            nodes={selectedNodes}
            assets={images.assets}
            canDuplicate={duplicableSelection}
            canDelete={deletableSelection}
            blockedReason={selectionBlockedReason}
            onDuplicate={handleDuplicateSelection}
            onDelete={handleDeleteSelection}
            onClearSelection={() => selectNodes([])}
          />
        ) : (
          <GenerationPanel
            mode={activeSlug}
            prompt={prompt}
            presetKey={activeSlug === 'text-to-image' ? textToImageParameters.preset.key : presetKey}
            count={activeSlug === 'text-to-image' ? textToImageParameters.count : count}
            durationSeconds={durationSeconds}
            generateAudio={drafts['text-to-video'].generateAudio ?? false}
            onAudioChange={generateAudio => updateDraft({ generateAudio })}
            videoConfigured={videoConfiguration.ready}
            videoModel={videoModel}
            videoModels={videoConfiguration.models.filter(item => videoModelModes(item).includes('text_to_video'))}
            selectedVideoModelId={videoModelId}
            videoResolution={videoResolution}
            onVideoModelChange={modelProfileId => {
              const selected = videoConfiguration.models.find(item => item.id === modelProfileId)
              updateDraft({ modelProfileId, videoResolution: selected?.resolution, resolution: undefined,
                generateAudio: videoGenerateAudio(selected, videoDraft.generateAudio) })
            }}
            onVideoResolutionChange={videoResolution => updateDraft({ videoResolution })}
            videoAvailability={videoConfiguration.textState}
            onReloadModels={activeSlug === 'text-to-video' ? videoConfiguration.reload : textToImageConfiguration.reload}
            task={replicationTask ? undefined : generation.task}
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
            enableThinking={drafts['text-to-image'].enableThinking ?? false}
            onThinkingChange={enableThinking => updateDraft({ enableThinking })}
            estimatedCredits={activeSlug === 'text-to-video' ? videoCreditsForDuration(selectedVideoReady ? videoModel : undefined, durationSeconds, videoResolution) : textToImageParameters.estimatedCredits}
            resolutionAdjusted={textToImageParameters.resolutionAdjusted}
            ratioAdjusted={textToImageParameters.ratioAdjusted}
            countAdjusted={textToImageParameters.countAdjusted}
            modelsLoading={activeSlug === 'text-to-video' ? videoConfiguration.textState === 'loading' : textToImageConfiguration.loading}
            generateDisabled={activeSlug === 'text-to-image' ? !textToImageEntryEnabled : !videoConfiguration.ready || !selectedVideoReady || !!cloudProject}
            mockGateway={mockGateway}
            historyError={generation.historyError}
            historySaved={generation.historySaved}
            onRetrySave={generation.retryHistory}
            resultAssets={videos.assets}
          />
        )}
      </div>
    </div>
  )
}
