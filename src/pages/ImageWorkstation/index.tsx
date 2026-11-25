import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { UNSAFE_LocationContext, useNavigate, useParams } from 'react-router-dom'
import { DownloadOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import { App, Button, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { translateApiError } from '@/i18n/apiErrors'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import ToolSwitcher from '@/components/ToolSwitcher'
import CapabilityStatus from '@/components/CapabilityStatus'
import { useCapabilities } from '@/hooks/useCapabilities'
import { usePreviewGallery } from '@/components/usePreviewGallery'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import type { AssetId, ImageAsset } from '@/editor/types'
import { useImageWorkstationController } from '@/features/image-workstation/hooks/useImageWorkstationController'
import { useFusionImageSelection } from '@/features/image-workstation/hooks/useFusionImageSelection'
import { isPreparationCancelled } from '@/features/image-workstation/fusionInputs'
import {
  WORKSTATION_TOOLS,
  comingSoonSubmitMessage,
  fusionInputsRequiredReason,
  getWorkstationTool,
  isWorkstationToolReady,
  workstationDisplaysSourcePreview,
  workstationToolLabel,
} from '@/features/image-workstation/tools/registry'
import { presetForHandoff, setOutpaintHandoff, takeOutpaintHandoff } from '@/pages/Toolbox/aspect-ratio/handoff'
import { renderRefinedMatte } from '@/pages/Toolbox/bg-remove/edgeRefine'
import { clearEdgeRefineHandoff, setEdgeRefineHandoff, setEdgeRefineResult, takeEdgeRefineHandoff, type EdgeRefineHandoff } from '@/pages/Toolbox/bg-remove/session'
import { liveCapabilityReady } from '@/services/api/task'
import { canonicalizeImageModelProfileId, defaultImageModel } from '@shared/image-models'
import { normalizeRetouchDirections, type RetouchDirection } from '@shared/retouch'
import { paddingAround, planBailianOutpaint, validateOutpaintOutputSize } from '@shared/outpaint'
import { imageFileError, uploadImage } from '@/services/api/upload'
import { Capability } from '@/types'
import { downloadFailureMessage, downloadImageAsset, filenameForWorkstationResult, blobFromImageSource } from '@/features/image-workstation/download'
import { createResultZip, downloadBlob } from '@/pages/Toolbox/shared/zip'
import CanvasArea, { type CanvasHandle } from './components/CanvasArea'
import ImageAssetStrip from './components/ImageAssetStrip'
import VariationResultGrid from './components/VariationResultGrid'
import FusionInputStatus from './components/FusionInputStatus'
import ParamPanel from './components/ParamPanel'
import InpaintGuide from './components/InpaintGuide'
import { outputPreview } from './utils/outputPreview'
import RelightDirectionOverlay from './components/RelightDirectionOverlay'
import RelightExample from './components/RelightExample'
import SmartEditExample from './components/SmartEditExample'
import VariationExample from './components/VariationExample'
import RetouchExample from './components/RetouchExample'
import InpaintExample from './components/InpaintExample'
import FusionExample from './components/FusionExample'
import OutpaintExample from './components/OutpaintExample'
import { taskRunningReason, unavailableServiceMessage, workstationGenerateBlockReason } from './utils/generateGate'
import { EMPTY_ERASE_MASK_MESSAGE, EMPTY_REPAINT_MASK_MESSAGE, emptyMaskMessage } from './utils/maskExport'
import { freeOutpaintGeometry, outpaintHasWork, presetOutpaintGeometry, translateSharedOutpaintError } from './utils/outpaintGeometry'
import { outpaintTargetParameters } from './utils/outpaintTarget'
import { useWorkstationParameters } from '@/features/preferences/useWorkstationParameters'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { creditQuote, creditQuoteBlocked, creditQuoteLabel, imageCreditAmount, outpaintCreditAmount, positiveQuoteCount } from '@/features/credits/quotes'
import { imageCreditBlocksSubmit, insufficientCreditsReason } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { useImageModels } from '@/features/credits/useImageModels'
import { workstationRequestQuote } from '@/features/image-workstation/creditQuote'
import { isCanvasMockGateway } from '@/features/free-canvas/generation/availability'
import { syncCreditPrice } from '@shared/billing'
import { COUNT_TOOLS, type CountTool } from '@shared/preferences'
import { useStickyPreview } from './utils/useStickyPreview'
import { useStuckPreview } from './utils/useStuckPreview'
import { useWorkstationPromptHeight } from './utils/useWorkstationPromptHeight'
import TaskRecoveryPanel,{type RecoveryActionContext} from '@/features/task-center/TaskRecoveryPanel'
import WorkstationRecovery from '@/features/task-center/WorkstationRecovery'
import { saveWorkstationSession } from '@/features/task-center/workstationSession'
import { currentTaskActor } from '@/features/task-center/client'
import { useUserStore } from '@/store/useUserStore'
import { useTaskDraftGuard } from '@/features/task-center/useTaskDraftGuard'
import { assertRecoveryActor,persistRecoveredResult,recoveredResultId,readRecoveryImage } from '@/features/task-center/recoveryMedia'
import { bindRuntimeImage,releaseRuntimeImageUser,setRuntimeImageUsers,withRuntimeImage } from '@/editor/runtimeImages'
import {taskIsActive,type TaskTool,type TaskCenterMedia,type TaskCenterDetail,type TaskCenterSummary} from '@shared/task-center'
import {
  readRelight,
  type RelightDirection,
  type RelightQuality,
  type RelightTemperature,
} from '@shared/relight'
import { readKeepSourceSize, readRetouchDirections } from '@shared/retouch'
import WorkstationBridge, { type WorkstationSuiteBinding } from '@/features/ecommerce-suite/WorkstationBridge'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteBridgeDetail } from '@shared/ecommerce-suite-runtime'

const RETOUCH_DIRECTION_LABEL_KEYS = {
  blemish: 'retouch.directions.blemish.label',
  brighten: 'retouch.directions.brighten.label',
  sharpen: 'retouch.directions.sharpen.label',
  texture: 'retouch.directions.texture.label',
} as const satisfies Record<RetouchDirection, string>

const RELIGHT_DIRECTION_LABEL_KEYS = {
  left: 'relight.directions.left',
  right: 'relight.directions.right',
  top: 'relight.directions.top',
  bottom: 'relight.directions.bottom',
  front: 'relight.directions.front',
  back: 'relight.directions.back',
  'top-left': 'relight.directions.top-left',
  'top-right': 'relight.directions.top-right',
  'bottom-left': 'relight.directions.bottom-left',
  'bottom-right': 'relight.directions.bottom-right',
} as const satisfies Record<RelightDirection, string>

const RELIGHT_QUALITY_LABEL_KEYS = {
  soft: 'relight.qualities.soft',
  hard: 'relight.qualities.hard',
} as const satisfies Record<RelightQuality, string>

const RELIGHT_TEMPERATURE_LABEL_KEYS = {
  warm: 'relight.temperatures.warm',
  neutral: 'relight.temperatures.neutral',
  cool: 'relight.temperatures.cool',
} as const satisfies Record<RelightTemperature, string>

function readableErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const apiError = error as Error & {
    code?: string
    status?: number
    requestId?: string
    extra?: Record<string, unknown>
  }
  return translateApiError({
    code: typeof apiError.code === 'string' ? apiError.code : undefined,
    status: typeof apiError.status === 'number' ? apiError.status : undefined,
    requestId: typeof apiError.requestId === 'string' ? apiError.requestId : undefined,
    extra: apiError.extra && typeof apiError.extra === 'object' ? apiError.extra : undefined,
    message: error.message,
    fallback,
  })
}

const VARIATION_PROMPT_DRAFT_KEY = 'pixel-aigc:variation-prompt-draft'

/** 只记住本次标签页里的裂变补充要求，关闭标签页即失效，避免把提示词写进长期偏好。 */
function readVariationPromptDraft() {
  try {
    return window.sessionStorage.getItem(VARIATION_PROMPT_DRAFT_KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

function writeVariationPromptDraft(value: string) {
  try {
    if (value.trim()) window.sessionStorage.setItem(VARIATION_PROMPT_DRAFT_KEY, value.trim())
    else window.sessionStorage.removeItem(VARIATION_PROMPT_DRAFT_KEY)
  } catch {
    // 隐私模式或存储被禁用时静默降级，不影响生成。
  }
}

export default function ImageWorkstation() {
  const { t } = useTranslation(['workstation', 'common', 'errors'])
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const location=useContext(UNSAFE_LocationContext)
  const bridgeId = new URLSearchParams(location?.location.search).get('bridgeId')
  const [suiteBinding, setSuiteBinding] = useState<WorkstationSuiteBinding>()
  const account=useUserStore(state=>state.account)
  const taskCenterEnabled = Boolean(account?.features?.taskCenter)
  const [observedTask,setObservedTask]=useState<{task:TaskCenterSummary;owner:string;scope:string}>()
  const observeRecoveredTask=useCallback(async(detail:TaskCenterDetail,context:RecoveryActionContext)=>{
    assertRecoveryActor(context.actor,context.signal)
    setObservedTask({task:detail.task,...context.actor})
  },[])
  const { message, notification, modal } = App.useApp()
  const knownBalance = useKnownCreditBalance()
  const project = useEditorStore(state => state.project)
  const canvasHandleRef = useRef<CanvasHandle | null>(null)
  const [sourceAsset, setSourceAsset] = useState<ImageAsset>()
  const [uploading, setUploading] = useState(false)
  const [compareMode, setCompareMode] = useState<'original' | 'effect'>('effect')
  // 精修结果只切换预览，不直接替换原图；需要继续精修时由显式操作确认。
  const [retouchPreviewId, setRetouchPreviewId] = useState<AssetId>()
  const [smartEditPrompt, setSmartEditPrompt] = useState('')
  const [variationPrompt, setVariationPrompt] = useState('')
  const [retouchNote, setRetouchNote] = useState('')
  const [fusionNote, setFusionNote] = useState('')
  const [relightNote, setRelightNote] = useState('')
  const [relightOverlayEnabled, setRelightOverlayEnabled] = useState(true)
  const [retryReadFailedTaskId, setRetryReadFailedTaskId] = useState<string>()
  const imageConfiguration = useImageModels('image_edit')
  const variationConfiguration = useImageModels('variation')
  const imageModels = imageConfiguration.models
  const variationModels = variationConfiguration.models
  const [modelProfileId, setModelProfileId] = useState(() => defaultImageModel('image_edit')?.id)
  const [variationModelId, setVariationModelId] = useState(() => defaultImageModel('variation')?.id)
  const [relightModelId, setRelightModelId] = useState(() => defaultImageModel('image_edit')?.id)
  const [erasePrompt, setErasePrompt] = useState('')
  const [repaintPrompt, setRepaintPrompt] = useState('')
  const [outpaintTargetSize, setOutpaintTargetSize] = useState<{ width: number; height: number }>()
  const [edgeRefine, setEdgeRefine] = useState<EdgeRefineHandoff | null>(null)
  const { capabilities: { erase: eraseReady, repaint: repaintReady, imageEdit: imageEditReady, variation: variationReady }, error: capabilityError, refetch: refetchCapabilities } = useCapabilities()
  const [hasMaskPaint, setHasMaskPaint] = useState(false)
  const [downloadingAssetId, setDownloadingAssetId] = useState<string>()
  const [downloadingAll, setDownloadingAll] = useState(false)
  const [lastVariationPrompt, setLastVariationPrompt] = useState(readVariationPromptDraft)
  const edgeRefineFinishedRef = useRef(false)
  const activeTool = getWorkstationTool(tool)
  const activeToolLabel = workstationToolLabel(activeTool.slug)
  const currentActor=currentTaskActor()
  const recoveringActive=account?.features?.taskCenter&&observedTask?.owner===currentActor?.owner&&observedTask?.scope===currentActor?.scope&&observedTask?.task.tool===activeTool.slug
    &&observedTask.task.taskKey===new URLSearchParams(location?.location.search).get('task')&&taskIsActive(observedTask.task)
  const { parameters, update: updateParameters } = useWorkstationParameters(activeTool.slug)
  const { retouchDirections, relight: relightOptions, count: activeCount, resolution: editResolution, keepSourceSize, outpaintMode, outpaintOutputMode, presetPlatform } = parameters
  const fusionSelection = useFusionImageSelection(activeTool.slug)
  const fusionProduct = fusionSelection.product
  const fusionReference = fusionSelection.reference
  const fusionLoading = fusionSelection.loading.product || fusionSelection.loading.reference
  const capabilityState = useCallback((capability: Capability) => {
    if (capability === Capability.ImageEdit || capability === Capability.Retouch || capability === Capability.Fusion || capability === Capability.Relight) return imageEditReady
    if (capability === Capability.Variation) return variationReady
    return liveCapabilityReady(capability)
  }, [imageEditReady, variationReady])
  const capabilityReady = useCallback((capability: Capability) => capabilityState(capability) === true, [capabilityState])
  const toolReady = isWorkstationToolReady(activeTool, capabilityReady)
  const toolState = toolReady ? true : isWorkstationToolReady(activeTool, capability => capabilityState(capability) !== false) ? undefined : false
  const configurationReady = activeTool.slug === 'repaint' ? repaintReady : activeTool.slug === 'remove' ? eraseReady : toolState
  const showSourcePreview = workstationDisplaysSourcePreview(activeTool.interactionMode) && toolState !== false
  const variationTool = activeTool.capability === Capability.Variation
  const outpaintTool = activeTool.capability === Capability.Outpaint
  // 裂变补充要求只在本次会话里记住；停止输入 400ms 后落盘，避免每次按键都写存储。
  useEffect(() => {
    if (!variationTool || !variationPrompt.trim()) return
    const timer = window.setTimeout(() => {
      const value = variationPrompt.trim()
      setLastVariationPrompt(value)
      writeVariationPromptDraft(value)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [variationPrompt, variationTool])
  const retouchTool = activeTool.slug === 'retouch'
  const retouchDirectionSummary = normalizeRetouchDirections(retouchDirections)
    .map(direction => t(RETOUCH_DIRECTION_LABEL_KEYS[direction]))
    .join(t('common.listSeparator'))
  const fusionTool = activeTool.slug === 'fusion'
  const relightTool = activeTool.slug === 'relight'
  const smartEditTool = activeTool.slug === 'smart-edit'
  const activePrompt = relightTool
    ? relightNote
    : fusionTool
    ? fusionNote
    : retouchTool
      ? retouchNote
      : activeTool.capability === Capability.ImageEdit
      ? smartEditPrompt
      : variationTool
        ? variationPrompt
        : activeTool.slug === 'remove'
          ? erasePrompt
          : repaintPrompt
  const activeModels = variationTool ? variationModels : imageModels
  const activeConfiguration = variationTool ? variationConfiguration : imageConfiguration
  const selectedModelId = relightTool ? relightModelId : variationTool ? variationModelId : modelProfileId
  const activeModel = activeModels.find(model => model.id === selectedModelId)
    ?? activeModels.find(model => model.defaultFor?.includes(variationTool ? 'variation' : 'image_edit')) ?? activeModels[0]
  const activeModelId = activeModel?.id
  const controller = useImageWorkstationController({
    suiteBridge: bridgeId === suiteBinding?.id ? suiteBinding : undefined,
    activeTool,
    initialAsset: fusionTool ? fusionProduct : sourceAsset,
    prompt: activePrompt,
    count: activeCount,
    resolution: editResolution,
    keepSourceSize,
    modelProfileId: activeModelId,
    modelUi: activeModel?.ui,
    capabilityReady,
    retouchDirections,
    relight: relightOptions,
    productAsset: fusionProduct,
    referenceAsset: fusionReference,
    useProductAsset: fusionTool,
    keepInputOnSuccess: activeTool.slug === 'repaint' || activeTool.slug === 'remove' || activeTool.slug === 'retouch',
  })
  // 任务成功不等于结果可用：等结果读取结束后，由页面给出唯一结论。
  const notifiedResultRef = useRef<string>()
  useEffect(() => {
    const task = controller.activeTask
    if (!task || task.status !== 'succeeded' || controller.readingResults || taskCenterEnabled) return
    const key = `${task.id}:${controller.resultReadError ? 'error' : 'success'}`
    if (notifiedResultRef.current === key) return
    notifiedResultRef.current = key
    // 读取失败的唯一结论在页脚；这里只标记已通知，避免再叠加 toast。
    if (controller.resultReadError) return
    if (controller.outputAssets.length > 0) {
      notification.success({
        message: t('common:taskPolling.succeededTitle'),
        description: activeTool.slug === 'retouch'
          ? t('notifications.retouchSucceeded', { count: controller.outputAssets.length })
          : activeTool.slug === 'repaint'
            ? t('notifications.repaintSucceeded', { count: controller.outputAssets.length })
            : t('notifications.genericSucceeded', { count: controller.outputAssets.length }),
      })
    }
  }, [activeTool.slug, controller.activeTask, controller.readingResults, controller.resultReadError, controller.outputAssets.length, taskCenterEnabled, notification, t])
  // 重试读取期间由 readingResults 保持按钮反馈；重试仍失败时给出「仍无法读取」的结论。
  const handleRetryRead = async () => {
    setRetryReadFailedTaskId(undefined)
    const succeeded = await controller.retryRead()
    if (!succeeded) setRetryReadFailedTaskId(controller.activeTask?.id ?? 'unknown')
  }
  // 只有「同一个任务重试后仍失败」才显示「仍无法读取」；换图或新任务会因任务 id 变化自动失效。
  const retryReadFailedAgain = Boolean(controller.resultReadError)
    && retryReadFailedTaskId === (controller.activeTask?.id ?? 'unknown')
  const effectiveParameters = effectiveImageParameters(activeCount, editResolution, fusionTool ? fusionProduct : controller.inputAsset, activeModel?.ui, retouchTool && keepSourceSize)
  const relightOutput = relightTool
    ? outputPreview(activeModel, controller.inputAsset ? { width: controller.inputAsset.width, height: controller.inputAsset.height } : undefined, effectiveParameters.resolution)
    : undefined
  // 融合是双图输入，输入图以商品图为准；缺失时按槽位给出下一步，而不是笼统的「等待上传」。
  const fusionInputHint = !fusionTool ? undefined : !fusionProduct ? t('fusion.uploadProductHint') : !fusionReference ? t('fusion.uploadReferenceHint') : undefined
  const previewSource = fusionTool ? fusionProduct : controller.inputAsset
  const sourceMeta = fusionInputHint ?? (previewSource ? `${previewSource.width}×${previewSource.height}` : t('preview.waitingUpload'))
  const previewMeta = controller.readingResults
    ? t('preview.readingResults')
    : controller.active || controller.submitting
      ? t('preview.generating')
      : controller.outputAssets.length > 0
        ? t('preview.generatedCount', { count: controller.outputAssets.length })
        : sourceMeta
  // 无结果时脚注给出下一步；读取中/读取失败时隐藏，避免描述不存在的「效果」。
  const previewFootnote = relightTool
    ? controller.readingResults || controller.resultReadError
      ? null
      : controller.outputAssets.length === 0
        ? t('canvas.footnotes.adjustAndGenerate')
        : undefined
    : undefined
  const previewHasImage = Boolean(fusionTool ? fusionProduct : showSourcePreview ? controller.inputAsset : undefined)
  const showRelightOverlay = relightTool && previewHasImage && relightOverlayEnabled
  const muteRelightOverlay = showRelightOverlay && compareMode === 'effect' && controller.outputAssets.length > 0
  const replaceSourceAsset = controller.replaceSourceAsset
  const previewPanelRef = useRef<HTMLElement>(null)
  const settingsPanelRef = useRef<HTMLElement>(null)
  // 涂抹类工具（消除/重绘）在移动端用紧凑吸顶态：滚到设置区时隐藏步骤条并压低画布，避免遮住表单。
  const inpaintTool = activeTool.slug === 'repaint' || activeTool.slug === 'remove'
  const previewStuck = useStuckPreview(previewPanelRef, (relightTool || inpaintTool || retouchTool) && previewHasImage)
  const promptMinHeight = useWorkstationPromptHeight({
    previewPanelRef,
    settingsPanelRef,
    activeToolSlug: activeTool.slug,
    enabled: activeTool.slug !== 'repaint' && activeTool.slug !== 'variation' && activeTool.slug !== 'fusion',
  })

  const inpaintMode = inpaintTool ? (activeTool.slug === 'repaint' ? 'repaint' : 'remove') : undefined
  // 消除/重绘走同步接口：submitting 覆盖读原图到请求往返，readingResults 覆盖下载解码与重试读取；
  // active 对这类任务恒为 false，不能单独用它判断。
  const inpaintProcessingLabel = !controller.resultReadError
    && (controller.active || controller.submitting || controller.readingResults)
    ? controller.readingResults
      ? t('preview.readingResultsWait')
      : t('preview.inpaintProcessing', { tool: activeToolLabel })
    : undefined
  const selectedPreset = PLATFORM_SIZE_PRESETS.find((preset) => preset.platform === presetPlatform)
  const presetTargetSize = useMemo(() => outpaintMode === 'preset' && selectedPreset
    ? { width: selectedPreset.width, height: selectedPreset.height }
    : undefined, [outpaintMode, selectedPreset])
  const taskSummary = useMemo(() => {
    const task = controller.activeTask
    if (!task) return undefined
    if (controller.protocolError) return undefined
    if (task.status === 'succeeded') {
      if (controller.outputAssets.length === 0) return undefined
      return t('tasks.succeededCount', { count: controller.outputAssets.length })
    }
    if (task.status === 'cancelled') return t('tasks.cancelledHint')
    if (task.status === 'failed') {
      if (task.errorCode === 'PROVIDER_FORBIDDEN') return t('errors.providerForbidden')
      return translateApiError({
        code: task.errorCode,
        message: task.errorMessage,
        fallback: t('tasks.failedFallback'),
      })
    }
    return t('tasks.processingWait')
  }, [controller.activeTask, controller.outputAssets.length, controller.protocolError, t])
  // 精修保留原图后，选中结果只影响预览；其他工具仍以「当前输入正好是结果」为准。
  const selectedResult = retouchTool
    ? controller.outputAssets.find((asset) => asset.id === retouchPreviewId)
      ?? controller.outputAssets.find((asset) => asset.id === controller.inputAsset?.id)
      ?? controller.outputAssets[0]
    : controller.outputAssets.find((asset) => asset.id === controller.inputAsset?.id)
      ?? controller.outputAssets[0]
  const resultPreviewItems: PreviewItem[] = controller.outputAssets.map(asset => {
    const generation = Object.values(project?.generations ?? {}).find(job => job.outputAssetIds.includes(asset.id))
    const source = generation?.inputAssetIds[0] ? project?.assets[generation.inputAssetIds[0]] : undefined
    return {
      id: asset.id,
      thumbSrc: asset.url,
      fullSrc: asset.url,
      originalSrc: source?.type === 'image' ? source.url : undefined,
      objectKey: asset.objectKey ?? asset.storage?.objectKey,
      title: asset.name,
      meta: { tool: activeToolLabel, resolution: `${asset.width}×${asset.height}` },
    }
  })
  const sourcePreviewItem: PreviewItem | undefined = sourceAsset && !resultPreviewItems.some(item => item.id === sourceAsset.id)
    ? {
      id: sourceAsset.id,
      thumbSrc: sourceAsset.url,
      fullSrc: sourceAsset.url,
      objectKey: sourceAsset.objectKey ?? sourceAsset.storage?.objectKey,
      title: sourceAsset.name || t('common:preview.originalShort'),
    }
    : undefined
  /** 融合输入图也进画廊，点击槽位可直接放大并和结果来回切换。 */
  const fusionInputPreviewItems: PreviewItem[] = fusionTool
    ? [fusionProduct, fusionReference].flatMap((asset, index) => asset ? [{
      id: asset.id,
      thumbSrc: asset.url,
      fullSrc: asset.url,
      objectKey: asset.objectKey ?? asset.storage?.objectKey,
      title: asset.name || t(index === 0 ? 'fusion.productSlot' : 'fusion.referenceSlot'),
      meta: { tool: activeToolLabel, resolution: `${asset.width}×${asset.height}` },
    }] : [])
    : []
  const previewItems = [...fusionInputPreviewItems, ...(sourcePreviewItem ? [sourcePreviewItem] : []), ...resultPreviewItems]
    .filter((item, index, all) => all.findIndex(entry => entry.id === item.id) === index)
  const { openAt, galleryProps } = usePreviewGallery(previewItems)
  const maskRequired = Boolean(inpaintMode) && !edgeRefine
  const referenceCount = fusionTool
    ? Number(Boolean(fusionProduct)) + Number(Boolean(fusionReference))
    : controller.inputAsset ? 1 : 0

  const handleCanvasReady = useCallback((handle: CanvasHandle | null) => {
    canvasHandleRef.current = handle
  }, [])

  /** 参数面板的精确宽高回填到扩图画布；画布收口后再通过 onTargetSizeChange 同步回来。 */
  const commitOutpaintTargetSize = useCallback((size: { width: number; height: number }) => {
    const handle = canvasHandleRef.current
    if (handle && 'setTargetSize' in handle) handle.setTargetSize(size)
  }, [])

  const recoveryTool=activeTool.slug as TaskTool
  const isDraftDirty = Boolean(activePrompt.trim() || hasMaskPaint)
  const confirmRecovery = useTaskDraftGuard({ dirty: isDraftDirty,
    reason: t('recovery.unsavedDraftConfirm'),
    blocked: uploading || fusionLoading ? t('recovery.readingInputsBlocked') : undefined })
  const handleFusionUpload = async (slot: 'product' | 'reference', file: File) => {
    const invalid = imageFileError(file)
    if (invalid) { message.error(invalid); return }
    const actor=currentTaskActor();if(actor&&slot==='product')saveWorkstationSession(actor,recoveryTool,{input:undefined})
    controller.modifyParameters()
    try {
      await fusionSelection.load(slot, file)
      message.success(t(slot === 'product' ? 'fusion.productLoaded' : 'fusion.referenceLoaded'))
    } catch (error) {
      if (isPreparationCancelled(error)) return
      // 失败文案已由槽位内联展示，不再重复弹全局 toast。
    }
  }

  const handleImageUpload = useCallback(async (file: File) => {
    const invalid = imageFileError(file)
    if (invalid) { message.error(invalid); return }
    if (hasMaskPaint && !await confirmRecovery(t('recovery.replaceImageClearMaskConfirm'))) return
    const actor=currentTaskActor();if(actor)saveWorkstationSession(actor,recoveryTool,{input:undefined})
    setUploading(true)
    try {
      const uploaded = await uploadImage(file)
      const asset = createImageAsset({
        name: uploaded.name,
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
        source: 'upload',
      })
      setSourceAsset(asset)
      replaceSourceAsset(asset)
      setCompareMode('effect')
      message.success(t('upload.success'))
    } catch (error) {
      message.error(readableErrorMessage(error, t('errors.imageUploadFailed')))
    } finally {
      setUploading(false)
    }
  }, [confirmRecovery, hasMaskPaint, message, replaceSourceAsset, recoveryTool, t])

  const uploadRef = useRef(handleImageUpload)
  useEffect(() => { uploadRef.current = handleImageUpload }, [handleImageUpload])

  useEffect(() => {
    if (activeTool.slug !== 'outpaint') return
    const handoff = takeOutpaintHandoff()
    if (!handoff) return
    const preset = presetForHandoff(handoff.presetId)
    let active = true
    queueMicrotask(() => {
      if (!active || !preset) return
      updateParameters({ outpaintMode: 'preset', outpaintOutputMode: handoff.outputMode ?? 'platform', presetPlatform: preset.platform }, false)
    })
    void uploadRef.current(handoff.file).finally(() => {
      if (!active) setOutpaintHandoff(handoff)
    })
    return () => { active = false }
  }, [activeTool.slug, updateParameters])

  useEffect(() => {
    if (activeTool.slug !== 'remove') {
      clearEdgeRefineHandoff()
      let active = true
      queueMicrotask(() => { if (active) setEdgeRefine(null) })
      return () => { active = false }
    }
    const handoff = takeEdgeRefineHandoff()
    if (!handoff) return
    const actor=currentTaskActor();if(actor)saveWorkstationSession(actor,'remove',{input:undefined})
    edgeRefineFinishedRef.current = false
    const url = URL.createObjectURL(handoff.file)
    const asset = createImageAsset({
      name: handoff.file.name,
      url,
      width: handoff.width,
      height: handoff.height,
      source: 'upload',
    })
    queueMicrotask(() => {
      if (!active) return
      setSourceAsset(asset)
      replaceSourceAsset(asset)
      setEdgeRefine(handoff)
    })
    let active = true
    return () => {
      active = false
      URL.revokeObjectURL(url)
      if (!edgeRefineFinishedRef.current) setEdgeRefineHandoff(handoff)
    }
  }, [activeTool.slug, replaceSourceAsset])

  const finishEdgeRefine = async () => {
    if (!edgeRefine) return
    const handle = canvasHandleRef.current
    if (!handle || !('exportRefineMarks' in handle)) {
      message.error(t('errors.maskCanvasNotReady'))
      return
    }
    try {
      const matte = await renderRefinedMatte(edgeRefine.file, edgeRefine.matte, handle.exportRefineMarks())
      edgeRefineFinishedRef.current = true
      setEdgeRefineResult({ itemId: edgeRefine.itemId, matte, cancelled: false })
      navigate('/toolbox/bg-remove')
    } catch (error) {
      message.error(readableErrorMessage(error, t('errors.edgeRefineFailed')))
    }
  }

  const cancelEdgeRefine = () => {
    if (!edgeRefine) return
    edgeRefineFinishedRef.current = true
    setEdgeRefineResult({ itemId: edgeRefine.itemId, matte: null, cancelled: true })
    navigate('/toolbox/bg-remove')
  }

  const handleGenerate = async () => {
    if (bridgeId && (!suiteBinding || (controller.inputAsset?.objectKey ?? controller.inputAsset?.storage?.objectKey) !== suiteBinding.inputObjectKey)) {
      message.warning(t('bridge.restoreInputFirst'))
      return
    }
    if (creditQuoteBlocked(generateQuote)) {
      message.warning(t('credits.calculatingQuote'))
      return
    }
    if (configurationReady === undefined) {
      message.warning(capabilityError ? t('blockReasons.configLoadFailed') : t('blockReasons.loadingConfig'))
      return
    }
    if (!toolReady) {
      message.warning(comingSoonSubmitMessage())
      return
    }
    if (maskRequired && !hasMaskPaint) {
      message.warning(emptyMaskMessage(inpaintMode))
      return
    }
    if (activeTool.slug === 'repaint' && !repaintPrompt.trim()) {
      message.warning(t('errors:client.repaintEmptyPrompt'))
      return
    }
    // 新一轮生成重新判断读取结果，不沿用上一轮的「仍无法读取」结论。
    setRetryReadFailedTaskId(undefined)
    try {
      const submitted = await controller.generate(canvasHandleRef.current)
      // 同步工具在 await 返回时已经完成，完成态由页面统一提示，避免「已提交」与「已完成」双 toast。
      if (submitted?.status !== 'succeeded') message.success(t('notifications.taskSubmitted'))
    } catch (error) {
      if (isPreparationCancelled(error)) return
      const description = readableErrorMessage(error, t('errors.checkApiService'))
      const emptyMask = description === emptyMaskMessage('remove')
        || description === emptyMaskMessage('repaint')
        || description === EMPTY_ERASE_MASK_MESSAGE
        || description === EMPTY_REPAINT_MASK_MESSAGE
      if (emptyMask) message.warning(description)
      else message.error({ content: t('errors.taskSubmitFailedWithReason', { reason: description }), duration: 4 })
    }
  }

  /** 取消进行中的生成；失败时保留任务并提示，不影响已有结果。 */
  const handleCancelGeneration = async () => {
    try {
      await controller.cancel()
      message.success(t('notifications.generationCancelled'))
    } catch (error) {
      message.error(readableErrorMessage(error, t('errors.cancelFailed')))
    }
  }

  /** 把上次场景放回场景槽位；读取失败时提示重新上传，不阻塞当前操作。 */
  const handleReuseLastScene = async () => {
    const asset = await fusionSelection.reuseLastScene()
    if (!asset) message.warning(t('fusion.lastSceneUnavailable'))
  }

  const handleDownload = async (asset = selectedResult, index = 0) => {
    if (!asset) return
    setDownloadingAssetId(asset.id)
    try {
      await downloadImageAsset(asset, filenameForWorkstationResult({
        toolLabel: activeToolLabel,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        index: controller.outputAssets.length > 1 ? index + 1 : undefined,
      }))
    } catch (error) {
      message.error({ content: downloadFailureMessage(error), duration: 4 })
    } finally {
      setDownloadingAssetId(undefined)
    }
  }

  // 裂变结果一次打包下载，避免浏览器拦截连续多次的独立下载。
  const handleDownloadAll = async () => {
    const assets = controller.outputAssets
    if (assets.length === 0 || downloadingAll) return
    setDownloadingAll(true)
    try {
      const files = await Promise.all(assets.map(async (asset, index) => {
        const blob = await blobFromImageSource(asset.url, asset.objectKey ?? asset.storage?.objectKey)
        return {
          name: filenameForWorkstationResult({
            toolLabel: activeToolLabel,
            width: asset.width,
            height: asset.height,
            mimeType: blob.type || asset.mimeType,
            index: assets.length > 1 ? index + 1 : undefined,
          }),
          blob,
        }
      }))
      if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name)
        return
      }
      const zip = await createResultZip(files)
      downloadBlob(zip, t(variationTool ? 'files.variationZipName' : 'files.resultZipName', {
        tool: activeToolLabel,
        count: files.length,
      }))
    } catch (error) {
      message.error({ content: downloadFailureMessage(error), duration: 4 })
    } finally {
      setDownloadingAll(false)
    }
  }

  const handleSelectResult = async (assetId: AssetId) => {
    // 精修结果用于对比与导出，点缩略图只换预览，不替换原图。
    if (retouchTool) {
      setRetouchPreviewId(assetId)
      setCompareMode('effect')
      return
    }
    if (inpaintMode && hasMaskPaint
      && !await confirmRecovery(t('recovery.switchResultClearMaskConfirm'))) return
    controller.selectOutput(assetId)
    setCompareMode('effect')
  }

  /** 精修结果作为新输入是破坏性操作：确认后才替换当前原图。 */
  const handleContinueOnResult = (asset = selectedResult) => {
    if (!asset) return
    if (asset.id === controller.inputAsset?.id) {
      setCompareMode('effect')
      return
    }
    modal.confirm({
      title: t('retouch.continueConfirmTitle'),
      content: t('retouch.continueConfirmContent'),
      okText: t('retouch.continueConfirmOk'),
      cancelText: t('common:actions.cancel'),
      onOk: () => {
        controller.selectOutput(asset.id)
        setRetouchPreviewId(undefined)
        setCompareMode('effect')
      },
    })
  }

  const handleRetry = async () => {
    if (controller.activeTask?.status !== 'succeeded' && creditQuoteBlocked(retryQuote)) {
      message.warning(t('errors.retryQuoteUnavailable'))
      return
    }
    try {
      await controller.retry()
      message.success(t(controller.activeTask?.status === 'succeeded' ? 'notifications.retriedRead' : 'notifications.resubmitted'))
    } catch (error) {
      if (isPreparationCancelled(error)) return
      message.error(readableErrorMessage(error, t('errors.taskRetryFailed')))
    }
  }
  const handleRetryInputs = async () => {
    try {
      const result = await controller.retryInputPreparation()
      if (result) message.success(t('notifications.taskSubmitted'))
    } catch (error) {
      if (!isPreparationCancelled(error)) message.error(readableErrorMessage(error, t('errors.inputRetryFailed')))
    }
  }

  const inputWidth = controller.inputAsset?.width ?? 0
  const inputHeight = controller.inputAsset?.height ?? 0
  const inputSize = useMemo(() => ({ width: inputWidth, height: inputHeight }), [inputWidth, inputHeight])
  // 目标几何只算一次：预计输出、积分与提交前限额校验共用同一份结果。
  const outpaintGeometry = useMemo(() => {
    if (!inputWidth || !inputHeight) return undefined
    try {
      return presetTargetSize
        ? presetOutpaintGeometry(inputWidth, inputHeight, presetTargetSize.width, presetTargetSize.height, outpaintOutputMode)
        : freeOutpaintGeometry(inputWidth, inputHeight, outpaintTargetSize?.width ?? inputWidth, outpaintTargetSize?.height ?? inputHeight)
    } catch {
      return undefined
    }
  }, [inputWidth, inputHeight, presetTargetSize, outpaintOutputMode, outpaintTargetSize])
  const predictedOutpaintSize = outpaintGeometry?.targetSize
  const mockGateway = isCanvasMockGateway()
  let outpaintCredits: number | undefined = syncCreditPrice('outpaint', 2)
  if (activeTool.capability === Capability.Outpaint && outpaintGeometry) {
    try { outpaintCredits = outpaintCreditAmount(outpaintGeometry) } catch { outpaintCredits = undefined }
  }
  // 零扩图时控制器会直接返回原图副本；限额校验提前到提交前，避免任务成功但结果不可用。
  const outpaintWork = activeTool.capability === Capability.Outpaint && outpaintGeometry
    ? outpaintHasWork(inputWidth, inputHeight, outpaintGeometry)
    : undefined
  const outpaintIdle = outpaintWork === false ? (presetTargetSize ? 'preset' : 'free') : undefined
  let outpaintLimitError: string | undefined
  if (activeTool.capability === Capability.Outpaint && outpaintGeometry && outpaintWork) {
    try {
      validateOutpaintOutputSize(outpaintGeometry.targetSize.width, outpaintGeometry.targetSize.height)
      const padding = paddingAround(
        outpaintGeometry.sourceSize.width,
        outpaintGeometry.sourceSize.height,
        outpaintGeometry.originOffset.x,
        outpaintGeometry.originOffset.y,
        outpaintGeometry.targetSize.width,
        outpaintGeometry.targetSize.height,
      )
      if (padding.left + padding.right + padding.top + padding.bottom > 0) {
        planBailianOutpaint(outpaintGeometry.sourceSize.width, outpaintGeometry.sourceSize.height, padding)
      }
    } catch (error) {
      outpaintLimitError = error instanceof Error
        ? translateSharedOutpaintError(error.message)
        : t('outpaint.errors.exceedsServiceLimit')
    }
  }
  const generateQuote = inpaintMode
    ? creditQuote(syncCreditPrice(inpaintMode === 'remove' ? 'erase' : 'repaint'), { mock: mockGateway })
    : activeTool.capability === Capability.Outpaint
      ? creditQuote(outpaintCredits, { maximum: true, mock: mockGateway && outpaintCredits !== 0 })
      : creditQuote(imageCreditAmount(activeModel, positiveQuoteCount(effectiveParameters.count, activeCount) ?? 0, effectiveParameters.resolution), { loading: activeConfiguration.loading, mock: mockGateway })
  const retryQuote = workstationRequestQuote(controller.activeTask, [...imageModels, ...variationModels], {
    mock: mockGateway, loading: controller.activeTask?.capability === Capability.Variation ? variationConfiguration.loading : imageConfiguration.loading,
  })
  const inputRetryQuote = workstationRequestQuote(controller.inputRetryRequest, imageModels, { mock: mockGateway, loading: imageConfiguration.loading })
  const creditBlocked = imageCreditBlocksSubmit({ mock: mockGateway, quote: generateQuote, balance: knownBalance })
  const retryCreditBlocked = imageCreditBlocksSubmit({ mock: mockGateway, quote: retryQuote, balance: knownBalance })
  const bridgeBlock = bridgeId && (!suiteBinding || (controller.inputAsset?.objectKey ?? controller.inputAsset?.storage?.objectKey) !== suiteBinding.inputObjectKey)
    ? t('bridge.restoreBeforeSubmit') : undefined
  const generateBlockReason = fusionTool && fusionLoading ? t('fusion.waitingImageLoad') : workstationGenerateBlockReason({
    toolReady,
    configurationPending: configurationReady === undefined && !capabilityError,
    configurationError: configurationReady === undefined && Boolean(capabilityError),
    hasInput: fusionTool ? Boolean(fusionProduct && fusionReference) : Boolean(controller.inputAsset),
    formLocked: controller.formLocked,
    submitting: controller.submitting,
    maskRequired,
    hasMaskPaint,
    repaintBlocked: activeTool.slug === 'repaint' && repaintReady === false,
    removeBlocked: activeTool.slug === 'remove' && eraseReady === false,
    retouchBlocked: retouchTool && normalizeRetouchDirections(retouchDirections).length === 0,
    fusionBlocked: fusionTool && (!fusionProduct || !fusionReference),
    promptRequired: activeTool.capability === Capability.ImageEdit || activeTool.slug === 'repaint',
    promptEmpty: !activePrompt.trim(),
    referenceCount: variationTool || fusionTool || activeTool.capability === Capability.ImageEdit || retouchTool || relightTool ? referenceCount : undefined,
    maxRefImages: activeModel?.ui.maxRefImages,
    outpaintIdle,
    outpaintLimitError,
    mode: inpaintMode,
  })
  const blockReason = bridgeBlock ?? generateBlockReason ?? (creditBlocked ? insufficientCreditsReason() : undefined)
  // 提交函数每次渲染都会重建；ref 只保存最新版本，键盘监听不必随渲染重挂。
  const generateRef = useRef(handleGenerate)
  useEffect(() => { generateRef.current = handleGenerate })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (edgeRefine || blockReason || controller.submitting || controller.inputPreparation) return
      // 弹窗或大图预览打开时不穿透提交。
      if (document.querySelector('.ant-modal-root, .ant-image-preview-root')) return
      event.preventDefault()
      void generateRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blockReason, controller.inputPreparation, controller.submitting, edgeRefine])
  const showRetryRead = Boolean(controller.resultReadError) || controller.readingResults
  const { previewRef, footerRef, sticky } = useStickyPreview(true)
  const inputDescription = recoveringActive&&!controller.inputAsset&&!fusionProduct&&!fusionReference
    ? t('recovery.syncingTask')
    : fusionTool
    ? t('footer.fusionInputDescription', {
        product: fusionProduct
          ? t('footer.fusionProductSize', { width: fusionProduct.width, height: fusionProduct.height })
          : t('fusion.uploadProductHint'),
        reference: fusionReference
          ? t('footer.fusionReferenceSize', { width: fusionReference.width, height: fusionReference.height })
          : t('fusion.uploadReferenceHint'),
      })
    : !showSourcePreview
      ? t('footer.comingSoonNoPreviousInput')
      : controller.inputAsset
        ? `${controller.inputAsset.name} · ${controller.inputAsset.width}×${controller.inputAsset.height}`
        : t('blockReasons.uploadImageFirst')
  // 读取失败的唯一结论：原因、可用张数、计费提醒都收在这一句里。
  const readFailureReason = controller.resultReadError
    ? translateApiError({ message: controller.resultReadError, fallback: t('errors.resultReadFailed') })
    : t('errors.resultReadFailed')
  const readSuccessCount = controller.outputAssets.length
  const readFailureCount = controller.resultReadFailureCount
  const readFailureSummary = readFailureCount > 0 && readSuccessCount > 0
    ? retryReadFailedAgain
      ? t('footer.readPartialFailedAgain', { ready: readSuccessCount, failed: readFailureCount, reason: readFailureReason })
      : t('footer.readPartialFailed', { ready: readSuccessCount, failed: readFailureCount, reason: readFailureReason })
    : retryReadFailedAgain
      ? t('footer.readFailedAgain', { reason: readFailureReason })
      : t('footer.readFailed', { reason: readFailureReason })
  const footerInfo = controller.resultReadError
    ? readFailureSummary
    : controller.active || controller.submitting
      ? t('footer.generatingWait')
      : controller.outputAssets.length > 0
        ? t('footer.generatedWithInput', { count: controller.outputAssets.length, input: inputDescription })
        : inputDescription
  const inpaintCreditLabel = inpaintMode && generateQuote.status !== 'loading' && generateQuote.status !== 'unavailable'
    ? creditQuoteLabel(generateQuote)
    : undefined
  // 禁用原因不能只藏在 hover tooltip 里；页脚已说明缺图或正在生成时不再重复。
  const duplicateFusionInputReason = fusionTool && blockReason === fusionInputsRequiredReason()
  const busy = controller.active || controller.submitting || controller.readingResults
  const duplicateBusyReason = busy && blockReason === taskRunningReason()
  const visibleBlockReason = blockReason && !duplicateFusionInputReason && !duplicateBusyReason && blockReason !== footerInfo && !creditBlocked && configurationReady !== undefined && toolReady
    ? blockReason
    : undefined
  const hasPreservedInput = Boolean(inpaintMode || retouchTool)
    && controller.outputAssets.length > 0
    && !controller.outputAssets.some(asset => asset.id === controller.inputAsset?.id)
  // 涂抹类与精修完成后，「下载结果」是主操作；「再生成一版」降为次操作。
  const downloadIsPrimary = Boolean(inpaintMode || retouchTool) && controller.outputAssets.length > 0 && Boolean(selectedResult)
  const recoveryRuntime = useRef({})
  useEffect(() => { const user = recoveryRuntime.current; return () => releaseRuntimeImageUser(user) }, [])
  useEffect(() => useUserStore.subscribe((state, previous) => {
    if (state.userId !== previous.userId || state.account?.runtimeScope !== previous.account?.runtimeScope) {
      setSourceAsset(undefined); setSuiteBinding(undefined); setHasMaskPaint(false)
      releaseRuntimeImageUser(recoveryRuntime.current)
    }
  }), [])
  const applyRecoveredInput=async(result:TaskCenterMedia,image:Awaited<ReturnType<typeof readRecoveryImage>>,detail:TaskCenterDetail,context:RecoveryActionContext)=>{
    assertRecoveryActor(context.actor,context.signal)
    const asset=createImageAsset({id:'asset:'+recoveredResultId(detail,result),name:t('recovery.recoveredAssetName'),url:result.url,objectKey:result.objectKey,width:image.width,height:image.height,mimeType:image.mimeType,source:'generation'})
    bindRuntimeImage(context.actor.owner,asset,image.blob,recoveryRuntime.current)
    useEditorStore.getState().registerAsset(asset)
    setRuntimeImageUsers(recoveryRuntime.current,[asset.id,...(fusionReference ? [fusionReference.id] : [])])
    const visibleAsset=withRuntimeImage(asset,context.actor.owner)
    if(fusionTool)fusionSelection.adopt(visibleAsset,fusionReference)
    else {setSourceAsset(visibleAsset);replaceSourceAsset(asset)}
    setHasMaskPaint(false)
  }
  const applySuiteInput = useCallback((detail: SuiteBridgeDetail, blob: Blob, actor: SuiteActor) => {
    const current = useUserStore.getState().account
    if (current?.userId !== actor.userId || current.runtimeScope !== actor.runtimeScope) throw new Error(t('errors.accountOrScopeChanged'))
    const asset = createImageAsset({ id: `asset:suite-bridge:${detail.bridge.id}`, name: t('bridge.suiteVersionName', { version: detail.version.versionNumber }),
      url: `/local-image/suite-bridge-${detail.bridge.id}`, objectKey: detail.asset.objectKey,
      width: detail.asset.size.width, height: detail.asset.size.height, mimeType: detail.asset.mimeType, source: 'upload' })
    bindRuntimeImage(actor.userId, asset, blob, recoveryRuntime.current)
    useEditorStore.getState().registerAsset(asset)
    setRuntimeImageUsers(recoveryRuntime.current, [asset.id])
    setSourceAsset(withRuntimeImage(asset, actor.userId)); replaceSourceAsset(asset); setHasMaskPaint(false)
  }, [replaceSourceAsset, t])
  return (
    <div className="image-workstation-page">
      <h1 className="sr-only">{t('pageHeading', { tool: activeToolLabel })}</h1>
      {bridgeId && <WorkstationBridge key={`${account?.userId}:${account?.runtimeScope}:${bridgeId}:${activeTool.slug}`} id={bridgeId} tool={activeTool.slug}
        task={controller.activeTask} disabled={controller.formLocked || uploading || fusionLoading} onInput={applySuiteInput} onBinding={setSuiteBinding} />}
      {!bridgeId && <WorkstationRecovery tool={activeTool.slug as TaskTool} nativeBusy={controller.formLocked||uploading||fusionLoading}
        hasDraft={isDraftDirty} onRestoreInput={applyRecoveredInput}/>}
      <TaskRecoveryPanel key={activeTool.slug} tools={[activeTool.slug as TaskTool]} onObserve={observeRecoveredTask} blockedReason={controller.formLocked || uploading || fusionLoading ? t('recovery.blockedBusy') : undefined}
        onUseImage={async (result,image,detail,context) => {
          if (!await confirmRecovery(t('recovery.useImageConfirm'))) return
          await applyRecoveredInput(result,image,detail,context)
          if((detail.task.sourceKind==='image_job'||detail.task.sourceKind==='sync_credit')&&!saveWorkstationSession(context.actor,activeTool.slug as TaskTool,{input:{sourceKind:detail.task.sourceKind,sourceId:detail.task.sourceId,ordinal:result.ordinal}}))message.warning(t('recovery.cacheSyncFailed'))
          await persistRecoveredResult(detail,result,context.actor,context.signal,image.blob)
        }}
        onLoadParameters={['smart-edit','relight','fusion','retouch','variation'].includes(activeTool.slug)?async (prepared,detail,context) => {
          const params=prepared.params
          if(!prepared.source || (fusionTool&&!prepared.reference))throw new Error(t('recovery.missingSourceOrRef'))
          if(typeof params.count!=='number'||!Number.isInteger(params.count)||params.count<1||!['1k','2k','4k'].includes(String(params.resolution)))throw new Error(t('recovery.incompleteParams'))
          if(params.prompt!==undefined&&typeof params.prompt!=='string')throw new Error(t('recovery.invalidPromptParam'))
          if(params.keepSourceSize!==undefined&&typeof params.keepSourceSize!=='boolean')throw new Error(t('recovery.invalidOutputSizeParam'))
          if(!await confirmRecovery(t('recovery.loadParamsConfirm')))return false
          assertRecoveryActor(context.actor,context.signal)
          saveWorkstationSession(context.actor,activeTool.slug as TaskTool,{input:undefined})
          const source=prepared.source
          bindRuntimeImage(context.actor.owner,source,prepared.sourceBlob!,recoveryRuntime.current)
          useEditorStore.getState().registerAsset(source)
          if(prepared.reference){bindRuntimeImage(context.actor.owner,prepared.reference,prepared.referenceBlob!,recoveryRuntime.current);useEditorStore.getState().registerAsset(prepared.reference)}
          setRuntimeImageUsers(recoveryRuntime.current,[source.id,...(prepared.reference ? [prepared.reference.id] : [])])
          const visibleSource=withRuntimeImage(source,context.actor.owner)
          if(fusionTool)fusionSelection.adopt(visibleSource,prepared.reference ? withRuntimeImage(prepared.reference,context.actor.owner) : undefined)
          else {setSourceAsset(visibleSource);replaceSourceAsset(source)}
          const note=typeof params.prompt==='string'?params.prompt:''
          if(relightTool)setRelightNote(note);else if(fusionTool)setFusionNote(note);else if(retouchTool)setRetouchNote(note);else if(variationTool)setVariationPrompt(note);else setSmartEditPrompt(note)
          updateParameters({count:params.count,resolution:params.resolution as '1k'|'2k'|'4k',...(retouchTool?{retouchDirections:readRetouchDirections(params),keepSourceSize:readKeepSourceSize(params)}:{}),...(relightTool&&readRelight(params)?{relight:readRelight(params)}:{})},false)
          if(detail.task.modelProfileId){const storedModelId=canonicalizeImageModelProfileId(detail.task.modelProfileId);if(variationTool)setVariationModelId(storedModelId);else if(relightTool)setRelightModelId(storedModelId);else setModelProfileId(storedModelId)}
          setHasMaskPaint(false)
        }:undefined}/>
      <ToolSwitcher
        className="image-workstation-tool-switcher page-tab-row"
        options={WORKSTATION_TOOLS.map((item) => ({
          value: item.slug,
          label: workstationToolLabel(item.slug),
          ready: isWorkstationToolReady(item, capability => capabilityState(capability) !== false),
        }))}
        value={activeTool.slug}
        ariaLabel={t('toolSwitcherAria')}
        onChange={(slug) => navigate(`/image-workstation/${slug}`)}
      />
      <div className="image-workstation-main">
        <div ref={previewRef} className={`image-workstation-canvas-column${sticky ? ' is-sticky' : ''}`}>
          <section ref={previewPanelRef} className={`workstation-panel image-workstation-preview-panel${previewHasImage ? ' has-image' : ''}${relightTool ? ' is-relight' : ''}${inpaintTool ? ' is-inpaint' : ''}${fusionTool ? ' is-fusion' : ''}${previewStuck ? ' is-stuck' : ''}`} aria-labelledby="workstation-preview-heading">
            <div className="workstation-panel-heading-row">
              <h2 id="workstation-preview-heading" className="workstation-panel-heading">{t('preview.heading')}</h2>
              <span className="workstation-preview-meta" aria-live="polite">{previewMeta}</span>
            </div>
            {inpaintMode && controller.inputAsset && !edgeRefine ? (
              <InpaintGuide
                mode={inpaintMode}
                step={!hasMaskPaint ? 1 : inpaintMode === 'repaint' && !repaintPrompt.trim() ? 2 : 3}
              />
            ) : null}
            {inpaintMode && !edgeRefine ? (
              <div className="workstation-preview-compact-row">
                <p className="workstation-preview-compact-summary">
                  {hasMaskPaint ? t('preview.inpaintSummaryReady') : t('preview.inpaintSummaryEmpty')}
                </p>
              </div>
            ) : null}
            {relightTool ? (
              <div className="workstation-preview-compact-row">
                <p className="workstation-preview-compact-summary">
                  {t('relight.compass.summary', {
                    direction: t(RELIGHT_DIRECTION_LABEL_KEYS[relightOptions.direction]),
                    quality: t(RELIGHT_QUALITY_LABEL_KEYS[relightOptions.quality]),
                    temperature: t(RELIGHT_TEMPERATURE_LABEL_KEYS[relightOptions.temperature]),
                  })}
                </p>
                {previewHasImage ? (
                  <button
                    type="button"
                    className="workstation-preview-compact-toggle"
                    aria-label={t('relight.overlay.toggleLabel')}
                    aria-pressed={relightOverlayEnabled}
                    title={t('relight.overlay.toggleTitle')}
                    onClick={() => setRelightOverlayEnabled(enabled => !enabled)}
                  >
                    {relightOverlayEnabled ? <EyeOutlined aria-hidden="true" /> : <EyeInvisibleOutlined aria-hidden="true" />}
                  </button>
                ) : null}
              </div>
            ) : null}
            {retouchTool ? (
              <div className="workstation-preview-compact-row">
                <p className="workstation-preview-compact-summary">
                  {retouchDirectionSummary
                    ? t('preview.retouchSelectedSummary', { summary: retouchDirectionSummary })
                    : t('preview.retouchNoneSelected')}
                </p>
              </div>
            ) : null}
            <CanvasArea
              interactionMode={activeTool.interactionMode}
              activityLabel={recoveringActive ? t('canvas.activitySyncing') : controller.active ? t('canvas.activityGenerating') : undefined}
              processingLabel={inpaintMode ? inpaintProcessingLabel : !controller.resultReadError && (controller.active || controller.submitting) ? fusionTool ? t('canvas.processingFusion') : t('canvas.processingDefault') : undefined}
              overlay={showRelightOverlay ? (
                <RelightDirectionOverlay
                  direction={relightOptions.direction}
                  disabled={controller.formLocked}
                  muted={muteRelightOverlay}
                  onDirectionChange={direction => updateParameters({ relight: { ...relightOptions, direction } })}
                />
              ) : undefined}
              emptyExtra={
                relightTool && !previewHasImage
                  ? <RelightExample />
                  : fusionTool && !fusionProduct && !fusionReference
                    ? <FusionExample />
                    : smartEditTool && !previewHasImage
                      ? <SmartEditExample />
                      : variationTool && !previewHasImage
                        ? <VariationExample />
                        : retouchTool && !previewHasImage
                          ? <RetouchExample />
                          : inpaintMode && !previewHasImage
                            ? <InpaintExample mode={inpaintMode} />
                            : outpaintTool && !previewHasImage
                              ? <OutpaintExample />
                              : undefined
              }
              overlayToggle={relightTool && previewHasImage ? {
                label: t('relight.overlay.toggleLabel'),
                pressed: relightOverlayEnabled,
                onChange: () => setRelightOverlayEnabled(enabled => !enabled),
              } : undefined}
              overlayHint={relightTool && previewHasImage && relightOverlayEnabled ? t('relight.overlay.dragHint') : undefined}
              imageUrl={fusionTool ? fusionProduct?.url : showSourcePreview ? controller.inputAsset?.url : undefined}
              resultImageUrl={controller.outputAssets.length > 0 ? selectedResult?.url : undefined}
              imageObjectKey={fusionTool ? fusionProduct?.objectKey ?? fusionProduct?.storage?.objectKey : controller.inputAsset?.objectKey ?? controller.inputAsset?.storage?.objectKey}
              referenceImageUrl={fusionTool ? fusionReference?.url : undefined}
              originalImageUrl={showSourcePreview ? sourceAsset?.url : undefined}
              imageNaturalSize={inputSize}
              presetTargetSize={presetTargetSize}
              outpaintTargetSize={predictedOutpaintSize}
              outpaintIdle={outpaintIdle !== undefined}
              outpaintOutputMode={outpaintOutputMode}
              onOutpaintTargetSizeChange={setOutpaintTargetSize}
              compareMode={compareMode}
              uploading={uploading}
              fusionUploading={fusionSelection.loading}
              fusionErrors={fusionTool ? fusionSelection.errors : undefined}
              uploadDisabled={controller.formLocked || Boolean(edgeRefine)}
              paintDisabled={controller.formLocked || uploading || fusionLoading}
              refineMode={Boolean(edgeRefine)}
              onCompareModeChange={setCompareMode}
              onImageUpload={fusionTool ? (file) => { void handleFusionUpload('product', file) } : handleImageUpload}
              onReferenceImageUpload={(file) => { void handleFusionUpload('reference', file) }}
              onSwapImages={fusionTool ? fusionSelection.swap : undefined}
              onRemoveImage={fusionTool ? role => fusionSelection.clear(role) : undefined}
              lastScene={fusionTool ? fusionSelection.lastScene : undefined}
              onReuseLastScene={fusionTool ? handleReuseLastScene : undefined}
              reusingLastScene={fusionSelection.reusingLastScene}
              onReady={handleCanvasReady}
              onMaskChange={setHasMaskPaint}
              uploadHint={activeTool.slug === 'remove'
                ? t('canvas.upload.removeHint')
                : activeTool.slug === 'repaint'
                  ? t('canvas.upload.repaintHint')
                  : activeTool.slug === 'outpaint'
                    ? t('canvas.upload.outpaintHint')
                    : undefined}
              onPreview={(view) => {
                const id = view === 'original' ? sourceAsset?.id : selectedResult?.id ?? sourceAsset?.id
                if (id) openAt(id)
              }}
              onPreviewImage={fusionTool ? role => {
                const asset = role === 'product' ? fusionProduct : fusionReference
                if (asset) openAt(asset.id)
              } : undefined}
              compareAvailable={controller.outputAssets.length > 0}
              splitCompare={retouchTool && selectedResult?.id !== controller.inputAsset?.id}
              resultNaturalSize={selectedResult ? { width: selectedResult.width, height: selectedResult.height } : undefined}
              footnote={variationTool && (controller.readingResults || controller.resultReadError) ? null : previewFootnote}
            />
            {variationTool ? (
              <VariationResultGrid
                assets={controller.outputAssets}
                selectedAssetId={controller.inputAsset?.id}
                downloadingAssetId={downloadingAssetId}
                downloadingAll={downloadingAll}
                onSelect={(assetId) => void handleSelectResult(assetId)}
                onDownload={(asset, index) => void handleDownload(asset, index)}
                onPreview={openAt}
                onDownloadAll={() => void handleDownloadAll()}
              />
            ) : (
              <ImageAssetStrip
                assets={controller.outputAssets}
                selectedAssetId={retouchTool ? selectedResult?.id : controller.inputAsset?.id}
                variant={fusionTool || retouchTool ? 'result' : inpaintMode ? 'inpaint-result' : outpaintTool ? 'outpaint-result' : 'next-input'}
                layout={(fusionTool || retouchTool) && controller.outputAssets.length > 1 ? 'grid' : undefined}
                downloadingAssetId={downloadingAssetId}
                downloadingAll={downloadingAll}
                onSelect={(assetId) => void handleSelectResult(assetId)}
                onDownload={(asset, index) => void handleDownload(asset, index)}
                onPreview={openAt}
                onDownloadAll={(fusionTool || retouchTool) && controller.outputAssets.length > 1 ? () => void handleDownloadAll() : undefined}
                onContinue={retouchTool && selectedResult && selectedResult.id !== controller.inputAsset?.id ? handleContinueOnResult : undefined}
                continueLabel={t('retouch.continueResultLabel')}
                continueDisabled={controller.formLocked}
              />
            )}
          </section>
        </div>
        <aside ref={settingsPanelRef} className="workstation-panel image-workstation-settings" aria-labelledby="workstation-settings-heading">
          <div className="workstation-panel-heading-row">
            <div className="image-workstation-settings-heading">
              <h2 id="workstation-settings-heading" className="workstation-panel-heading">{activeToolLabel}</h2>
              {fusionTool ? <p className="image-workstation-settings-subtitle">{t('settings.fusionSubtitle')}</p> : null}
              {retouchTool ? <p className="image-workstation-settings-subtitle">{t('settings.retouchSubtitle')}</p> : null}
            </div>
            {relightOutput ? (
              <span className="workstation-settings-output">{t('params.predictedOutput', { size: relightOutput.size, resolution: relightOutput.resolution.toUpperCase() })}</span>
            ) : null}
          </div>
          <CapabilityStatus
            ready={configurationReady}
            error={capabilityError}
            unavailableMessage={activeTool.slug === 'repaint'
              ? unavailableServiceMessage('repaint')
              : activeTool.slug === 'remove'
                ? unavailableServiceMessage('remove')
                : t('toolsMeta.comingSoonUnavailable')}
            onRetry={() => void refetchCapabilities()}
          />
          {toolState !== false ? (
            <ParamPanel
              capability={activeTool.capability}
              mode={inpaintMode}
              smartEditPrompt={relightTool ? relightNote : fusionTool ? fusionNote : retouchTool ? retouchNote : variationTool ? variationPrompt : smartEditPrompt}
              onSmartEditPromptChange={relightTool ? setRelightNote : fusionTool ? setFusionNote : retouchTool ? setRetouchNote : variationTool ? setVariationPrompt : setSmartEditPrompt}
              count={effectiveParameters.count}
              onCountChange={count => updateParameters({ count })}
              relight={relightOptions}
              onRelightChange={relight => updateParameters({ relight })}
              retouchDirections={retouchDirections}
              onRetouchDirectionsChange={retouchDirections => updateParameters({ retouchDirections })}
              resolution={effectiveParameters.resolution}
              requestedResolution={retouchTool ? editResolution : undefined}
              onResolutionChange={resolution => updateParameters({ resolution })}
              keepSourceSize={keepSourceSize}
              onRetouchOutputChange={value => updateParameters(
                value === 'source' ? { keepSourceSize: true } : { keepSourceSize: false, resolution: value },
              )}
              models={activeModels}
              modelProfileId={activeModelId}
              onModelProfileIdChange={relightTool ? setRelightModelId : variationTool ? setVariationModelId : setModelProfileId}
              sourceSize={previewSource ? { width: previewSource.width, height: previewSource.height } : undefined}
              disabled={controller.formLocked}
              erasePrompt={erasePrompt}
              onErasePromptChange={setErasePrompt}
              repaintPrompt={repaintPrompt}
              onRepaintPromptChange={setRepaintPrompt}
              outpaintMode={outpaintMode}
              outpaintOutputMode={outpaintOutputMode}
              onOutpaintTargetModeChange={target => updateParameters(outpaintTargetParameters(target))}
              outpaintTargetSize={predictedOutpaintSize}
              onOutpaintTargetSizeChange={commitOutpaintTargetSize}
              presetPlatform={presetPlatform}
              onPresetPlatformChange={presetPlatform => updateParameters({ presetPlatform })}
              promptMinHeight={promptMinHeight}
              hasMaskPaint={hasMaskPaint}
              inpaintCreditLabel={inpaintCreditLabel}
              variationLastPrompt={lastVariationPrompt}
              onRestoreVariationPrompt={setVariationPrompt}
            />
          ) : null}
          {fusionTool ? <FusionInputStatus state={controller.inputPreparation} retryQuote={inputRetryQuote} onRetry={() => void handleRetryInputs()} onCancel={controller.cancelInputPreparation} onModify={controller.modifyParameters} /> : null}
          {(controller.activeTask?.status === 'failed' || controller.activeTask?.status === 'cancelled') && <CreditQuoteNotice quote={retryQuote} onRetry={() => { void imageConfiguration.refetch(); void variationConfiguration.refetch() }} />}
          <GenerationTaskStatus
            task={controller.activeTask}
            submitting={controller.submitting && !controller.inputPreparation}
            active={controller.active}
            polling={controller.polling}
            summary={taskSummary}
            submissionError={controller.submissionError}
            protocolError={controller.protocolError}
            readingResults={controller.readingResults}
            resultUnavailable={Boolean(controller.resultReadError)}
            historyError={controller.historyError}
            historySaved={controller.historySaved}
            onRetrySave={() => void controller.retrySave()}
            pollError={controller.pollError}
            onRetry={() => void handleRetry()}
            retryDisabled={retryCreditBlocked}
            retryQuote={controller.activeTask?.status === 'succeeded' ? undefined : retryQuote}
            onModifyParameters={controller.modifyParameters}
            onRefetch={() => void controller.refetch()}
          />
        </aside>
      </div>
      <div ref={footerRef} className="image-workstation-footer">
        {!edgeRefine && configurationReady === true && <CreditQuoteNotice quote={generateQuote} onRetry={() => void activeConfiguration.refetch()} />}
        <div className="image-workstation-footer-row">
          <div className="image-workstation-footer-info">
            <span
              id={controller.resultReadError ? 'workstation-result-status' : undefined}
              className={`image-workstation-input-description${controller.resultReadError ? ' is-result-error' : ''}`}
              role={controller.resultReadError ? 'status' : undefined}
              aria-live={controller.resultReadError ? 'polite' : undefined}
              title={footerInfo}
            >
              {footerInfo}
            </span>
            {visibleBlockReason ? (
              <span id="workstation-block-reason" className="image-workstation-block-reason" role="status">
                {visibleBlockReason}
              </span>
            ) : null}
            {!edgeRefine ? (
              <span className="image-workstation-shortcut-hint" aria-hidden="true">{t('footer.shortcutHint')}</span>
            ) : null}
            {!edgeRefine && (
              <div className="image-workstation-footer-hints">
                <CreditBalanceNotice quote={generateQuote} />
                <CreditSettlementHint quote={generateQuote} />
              </div>
            )}
          </div>
          <div className="image-workstation-footer-actions">
            {edgeRefine ? (
              <>
                <Button onClick={cancelEdgeRefine}>{t('edgeRefine.cancel')}</Button>
                <Button type="primary" disabled={!controller.inputAsset} onClick={() => void finishEdgeRefine()}>{t('edgeRefine.finish')}</Button>
              </>
            ) : (
              <>
                {selectedResult ? (
                  <Button
                    type={downloadIsPrimary && !showRetryRead ? 'primary' : 'default'}
                    icon={<DownloadOutlined />}
                    disabled={controller.formLocked}
                    loading={downloadingAssetId === selectedResult.id}
                    onClick={() => void handleDownload(selectedResult, Math.max(0, controller.outputAssets.findIndex((asset) => asset.id === selectedResult.id)))}
                  >
                    {t('footer.downloadResult')}
                  </Button>
                ) : null}
                {showRetryRead ? (
                  <Button
                    type="primary"
                    loading={controller.readingResults}
                    onClick={() => void handleRetryRead()}
                  >
                    {controller.readingResults ? t('footer.reading') : t('footer.retryRead')}
                  </Button>
                ) : null}
                {controller.active ? (
                  <Button danger loading={controller.cancelling} onClick={() => void handleCancelGeneration()}>
                    {t('footer.cancelGeneration')}
                  </Button>
                ) : null}
                <Tooltip title={showRetryRead ? undefined : blockReason}>
                  <span>
                    <CreditActionButton data-task-generate
                      type={showRetryRead || downloadIsPrimary ? 'default' : 'primary'}
                      loading={controller.submitting}
                      quote={generateQuote}
                      aria-describedby={controller.resultReadError ? 'workstation-result-status' : visibleBlockReason ? 'workstation-block-reason' : undefined}
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                      disabled={Boolean(blockReason) || controller.submitting || controller.inputPreparation?.phase === 'failed'}
                      onClick={handleGenerate}
                    >
                      {hasPreservedInput
                        ? t('footer.generateAgain')
                        : COUNT_TOOLS.includes(activeTool.slug as CountTool)
                          ? t('footer.generateCount', { count: effectiveParameters.count })
                          : t('footer.generate')}
                    </CreditActionButton>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
      </div>
      <PreviewGallery {...galleryProps} downloadLabel={t('footer.downloadImage')} downloadTooltip={t('footer.downloadImage')} onDownload={item => {
        const index = controller.outputAssets.findIndex(asset => asset.id === item.id)
        if (index >= 0) return handleDownload(controller.outputAssets[index], index)
        const input = [fusionProduct, fusionReference].find(asset => asset?.id === item.id)
        if (input) return downloadImageAsset(input, input.name || t('files.defaultImageName'))
      }} />
    </div>
  )
}
