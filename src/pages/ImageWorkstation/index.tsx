import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DownloadOutlined } from '@ant-design/icons'
import { App, Button, Tooltip } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import ToolSwitcher from '@/components/ToolSwitcher'
import CapabilityStatus from '@/components/CapabilityStatus'
import { useCapabilities } from '@/hooks/useCapabilities'
import { usePreviewGallery } from '@/components/usePreviewGallery'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import type { ImageAsset } from '@/editor/types'
import { useImageWorkstationController } from '@/features/image-workstation/hooks/useImageWorkstationController'
import { useFusionImageSelection } from '@/features/image-workstation/hooks/useFusionImageSelection'
import { isPreparationCancelled } from '@/features/image-workstation/fusionInputs'
import { toolExample } from '@/features/image-workstation/tools/examples'
import {
  COMING_SOON_SUBMIT_MESSAGE,
  WORKSTATION_TOOLS,
  getWorkstationTool,
  isWorkstationToolReady,
  workstationDisplaysSourcePreview,
} from '@/features/image-workstation/tools/registry'
import { presetForHandoff, setOutpaintHandoff, takeOutpaintHandoff } from '@/pages/Toolbox/aspect-ratio/handoff'
import { renderRefinedMatte } from '@/pages/Toolbox/bg-remove/edgeRefine'
import { clearEdgeRefineHandoff, setEdgeRefineHandoff, setEdgeRefineResult, takeEdgeRefineHandoff, type EdgeRefineHandoff } from '@/pages/Toolbox/bg-remove/session'
import { liveCapabilityReady } from '@/services/api/task'
import { defaultImageModel } from '@shared/image-models'
import { normalizeRetouchDirections } from '@shared/retouch'
import { uploadImage } from '@/services/api/upload'
import { Capability } from '@/types'
import { downloadFailureMessage, downloadImageAsset, filenameForWorkstationResult } from '@/features/image-workstation/download'
import CanvasArea, { type CanvasHandle } from './components/CanvasArea'
import ImageAssetStrip from './components/ImageAssetStrip'
import FusionInputStatus from './components/FusionInputStatus'
import ParamPanel from './components/ParamPanel'
import ToolExampleStrip from './components/ToolExampleStrip'
import { workstationGenerateBlockReason } from './utils/generateGate'
import { taskFailureText } from '@/features/generation/providerErrorCopy'
import { freeOutpaintGeometry, presetOutpaintGeometry } from './utils/outpaintGeometry'
import { useWorkstationParameters } from '@/features/preferences/useWorkstationParameters'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { creditQuote, creditQuoteBlocked, imageCreditAmount, outpaintCreditAmount, positiveQuoteCount } from '@/features/credits/quotes'
import { INSUFFICIENT_CREDITS_REASON, imageCreditBlocksSubmit } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { useImageModels } from '@/features/credits/useImageModels'
import { workstationRequestQuote } from '@/features/image-workstation/creditQuote'
import { isCanvasMockGateway } from '@/features/free-canvas/generation/availability'
import { syncCreditPrice } from '@shared/billing'
import { COUNT_TOOLS, type CountTool } from '@shared/preferences'
import { useStickyPreview } from './utils/useStickyPreview'

export default function ImageWorkstation() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const knownBalance = useKnownCreditBalance()
  const project = useEditorStore(state => state.project)
  const canvasHandleRef = useRef<CanvasHandle | null>(null)
  const [sourceAsset, setSourceAsset] = useState<ImageAsset>()
  const [uploading, setUploading] = useState(false)
  const [compareMode, setCompareMode] = useState<'original' | 'effect'>('effect')
  const [smartEditPrompt, setSmartEditPrompt] = useState('')
  const [variationPrompt, setVariationPrompt] = useState('')
  const [retouchNote, setRetouchNote] = useState('')
  const [fusionNote, setFusionNote] = useState('')
  const [relightNote, setRelightNote] = useState('')
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
  const { capabilities: { repaint: repaintReady, imageEdit: imageEditReady, variation: variationReady }, error: capabilityError, refetch: refetchCapabilities } = useCapabilities()
  const [hasMaskPaint, setHasMaskPaint] = useState(false)
  const [downloadingAssetId, setDownloadingAssetId] = useState<string>()
  const edgeRefineFinishedRef = useRef(false)
  const activeTool = getWorkstationTool(tool)
  const { parameters, update: updateParameters } = useWorkstationParameters(activeTool.slug)
  const { retouchDirections, relight: relightOptions, count: activeCount, resolution: editResolution, outpaintMode, outpaintOutputMode, presetPlatform } = parameters
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
  const configurationReady = activeTool.slug === 'repaint' ? repaintReady : toolState
  const showSourcePreview = workstationDisplaysSourcePreview(activeTool.interactionMode) && toolState !== false
  const variationTool = activeTool.capability === Capability.Variation
  const retouchTool = activeTool.slug === 'retouch'
  const fusionTool = activeTool.slug === 'fusion'
  const relightTool = activeTool.slug === 'relight'
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
    activeTool,
    initialAsset: fusionTool ? fusionProduct : sourceAsset,
    prompt: activePrompt,
    count: activeCount,
    resolution: editResolution,
    modelProfileId: activeModelId,
    modelUi: activeModel?.ui,
    capabilityReady,
    retouchDirections,
    relight: relightOptions,
    productAsset: fusionProduct,
    referenceAsset: fusionReference,
    useProductAsset: fusionTool,
  })
  const effectiveParameters = effectiveImageParameters(activeCount, editResolution, fusionTool ? fusionProduct : controller.inputAsset, activeModel?.ui)
  const replaceSourceAsset = controller.replaceSourceAsset

  const inpaintMode = activeTool.slug === 'repaint' ? 'repaint' : activeTool.slug === 'remove' ? 'remove' : undefined
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
      return `已生成 ${controller.outputAssets.length} 个图片结果`
    }
    if (task.status === 'failed' || task.status === 'cancelled') return taskFailureText(task.errorCode, task.errorMessage, '任务没有完成，请重试')
    return '图片正在处理中，可以留在当前页面等待结果'
  }, [controller.activeTask, controller.outputAssets.length, controller.protocolError])
  const selectedResult = controller.outputAssets.find((asset) => asset.id === controller.inputAsset?.id)
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
      meta: { tool: activeTool.label, resolution: `${asset.width}×${asset.height}` },
    }
  })
  const sourcePreviewItem: PreviewItem | undefined = sourceAsset && !resultPreviewItems.some(item => item.id === sourceAsset.id)
    ? {
      id: sourceAsset.id,
      thumbSrc: sourceAsset.url,
      fullSrc: sourceAsset.url,
      objectKey: sourceAsset.objectKey ?? sourceAsset.storage?.objectKey,
      title: sourceAsset.name || '原图',
    }
    : undefined
  const previewItems = sourcePreviewItem ? [sourcePreviewItem, ...resultPreviewItems] : resultPreviewItems
  const { openAt, galleryProps } = usePreviewGallery(previewItems)
  const maskRequired = Boolean(inpaintMode) && !edgeRefine
  const referenceCount = fusionTool
    ? Number(Boolean(fusionProduct)) + Number(Boolean(fusionReference))
    : controller.inputAsset ? 1 : 0
  const generateBlockReason = fusionTool && fusionLoading ? '请等待图片载入完成' : workstationGenerateBlockReason({
    toolReady,
    configurationPending: configurationReady === undefined && !capabilityError,
    configurationError: configurationReady === undefined && Boolean(capabilityError),
    hasInput: fusionTool ? Boolean(fusionProduct && fusionReference) : Boolean(controller.inputAsset),
    formLocked: controller.formLocked,
    submitting: controller.submitting,
    maskRequired,
    hasMaskPaint,
    repaintBlocked: activeTool.slug === 'repaint' && repaintReady === false,
    retouchBlocked: retouchTool && normalizeRetouchDirections(retouchDirections).length === 0,
    fusionBlocked: fusionTool && (!fusionProduct || !fusionReference),
    referenceCount: variationTool || fusionTool || activeTool.capability === Capability.ImageEdit || retouchTool || relightTool ? referenceCount : undefined,
    maxRefImages: activeModel?.ui.maxRefImages,
    mode: inpaintMode,
  })

  const handleCanvasReady = useCallback((handle: CanvasHandle | null) => {
    canvasHandleRef.current = handle
  }, [])

  const handleFusionUpload = async (slot: 'product' | 'reference', file: File) => {
    controller.modifyParameters()
    try {
      await fusionSelection.load(slot, file)
      message.success(slot === 'product' ? '商品图已载入' : '场景图已载入')
    } catch (error) {
      if (isPreparationCancelled(error)) return
      message.error(error instanceof Error ? error.message : '图片上传失败')
    }
  }

  const handleImageUpload = useCallback(async (file: File) => {
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
      message.success('图片已上传')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败')
    } finally {
      setUploading(false)
    }
  }, [message, replaceSourceAsset])

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
      message.error('蒙版画布尚未准备好')
      return
    }
    try {
      const matte = await renderRefinedMatte(edgeRefine.file, edgeRefine.matte, handle.exportRefineMarks())
      edgeRefineFinishedRef.current = true
      setEdgeRefineResult({ itemId: edgeRefine.itemId, matte, cancelled: false })
      navigate('/toolbox/bg-remove')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '边缘精修失败')
    }
  }

  const cancelEdgeRefine = () => {
    if (!edgeRefine) return
    edgeRefineFinishedRef.current = true
    setEdgeRefineResult({ itemId: edgeRefine.itemId, matte: null, cancelled: true })
    navigate('/toolbox/bg-remove')
  }

  const handleGenerate = async () => {
    if (creditQuoteBlocked(generateQuote)) {
      message.warning('请等待报价加载完成，或重新加载报价')
      return
    }
    if (configurationReady === undefined) {
      message.warning(capabilityError ? '功能配置加载失败，请重试' : '正在加载功能配置，请稍候')
      return
    }
    if (!toolReady) {
      message.warning(COMING_SOON_SUBMIT_MESSAGE)
      return
    }
    if (maskRequired && !hasMaskPaint) {
      message.warning(inpaintMode === 'repaint' ? '请先涂抹要重绘的区域' : '请先涂抹要消除的区域')
      return
    }
    try {
      await controller.generate(canvasHandleRef.current)
      message.success('任务已提交')
    } catch (error) {
      if (isPreparationCancelled(error)) return
      const description = error instanceof Error ? error.message : '请检查 API 服务是否已启动'
      const emptyMask = description.includes('请先涂抹')
      if (emptyMask) message.warning(description)
      else message.error({ content: `任务提交失败：${description}`, duration: 4 })
    }
  }

  const handleDownload = async (asset = selectedResult, index = 0) => {
    if (!asset) return
    setDownloadingAssetId(asset.id)
    try {
      await downloadImageAsset(asset, filenameForWorkstationResult({
        toolLabel: activeTool.label,
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

  const handleRetry = async () => {
    if (controller.activeTask?.status !== 'succeeded' && creditQuoteBlocked(retryQuote)) {
      message.warning('原任务报价暂不可用，请修改参数后重新生成')
      return
    }
    try {
      await controller.retry()
      message.success(controller.activeTask?.status === 'succeeded' ? '已重试读取已有结果' : '已按原参数重新提交')
    } catch (error) {
      if (isPreparationCancelled(error)) return
      message.error(error instanceof Error ? error.message : '任务重试失败')
    }
  }
  const handleRetryInputs = async () => {
    try {
      const result = await controller.retryInputPreparation()
      if (result) message.success('任务已提交')
    } catch (error) {
      if (!isPreparationCancelled(error)) message.error(error instanceof Error ? error.message : '输入重试失败')
    }
  }

  const inputWidth = controller.inputAsset?.width ?? 0
  const inputHeight = controller.inputAsset?.height ?? 0
  const inputSize = useMemo(() => ({ width: inputWidth, height: inputHeight }), [inputWidth, inputHeight])
  const predictedOutpaintSize = inputWidth && inputHeight
    ? presetTargetSize
      ? presetOutpaintGeometry(inputWidth, inputHeight, presetTargetSize.width, presetTargetSize.height, outpaintOutputMode).targetSize
      : outpaintTargetSize ?? inputSize
    : undefined
  const mockGateway = isCanvasMockGateway()
  let outpaintCredits: number | undefined = syncCreditPrice('outpaint', 2)
  if (activeTool.capability === Capability.Outpaint && inputWidth && inputHeight) {
    try {
      const geometry = presetTargetSize
        ? presetOutpaintGeometry(inputWidth, inputHeight, presetTargetSize.width, presetTargetSize.height, outpaintOutputMode)
        : freeOutpaintGeometry(inputWidth, inputHeight, predictedOutpaintSize?.width ?? inputWidth, predictedOutpaintSize?.height ?? inputHeight)
      outpaintCredits = outpaintCreditAmount(geometry)
    } catch { outpaintCredits = undefined }
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
  const blockReason = generateBlockReason ?? (creditBlocked ? INSUFFICIENT_CREDITS_REASON : undefined)
  const example = toolExample(activeTool.slug)
  const showExample = Boolean(example) && (fusionTool ? !fusionProduct && !fusionReference : !controller.inputAsset)
  const hasVisibleInput = fusionTool ? Boolean(fusionProduct || fusionReference) : Boolean(showSourcePreview && controller.inputAsset)
  const { previewRef, footerRef, sticky } = useStickyPreview(hasVisibleInput && !showExample)
  const inputDescription = fusionTool
    ? `${fusionProduct ? `商品 ${fusionProduct.width}×${fusionProduct.height}` : '请上传商品图'} · ${fusionReference ? `场景 ${fusionReference.width}×${fusionReference.height}` : '请上传场景图'}`
    : !showSourcePreview
      ? '当前工具即将上线，不会使用上一工具的图片'
      : controller.inputAsset
        ? `${controller.inputAsset.name} · ${controller.inputAsset.width}×${controller.inputAsset.height}`
        : '请先上传需要处理的图片'

  return (
    <div className="image-workstation-page">
      <ToolSwitcher
        className="image-workstation-tool-switcher page-tab-row"
        options={WORKSTATION_TOOLS.map((item) => ({
          value: item.slug,
          label: item.label,
          ready: isWorkstationToolReady(item, capability => capabilityState(capability) !== false),
        }))}
        value={activeTool.slug}
        onChange={(slug) => navigate(`/image-workstation/${slug}`)}
      />
      <div className="image-workstation-main">
        <div ref={previewRef} className={`image-workstation-canvas-column${sticky ? ' is-sticky' : ''}`}>
          <section className="workstation-panel image-workstation-preview-panel" aria-labelledby="workstation-preview-heading">
            <h2 id="workstation-preview-heading" className="workstation-panel-heading">图片与预览</h2>
            <CanvasArea
              interactionMode={activeTool.interactionMode}
              imageUrl={fusionTool ? fusionProduct?.url : showSourcePreview ? controller.inputAsset?.url : undefined}
              imageObjectKey={fusionTool ? fusionProduct?.objectKey ?? fusionProduct?.storage?.objectKey : controller.inputAsset?.objectKey ?? controller.inputAsset?.storage?.objectKey}
              referenceImageUrl={fusionTool ? fusionReference?.url : undefined}
              originalImageUrl={showSourcePreview ? sourceAsset?.url : undefined}
              imageNaturalSize={inputSize}
              presetTargetSize={presetTargetSize}
              outpaintOutputMode={outpaintOutputMode}
              onOutpaintTargetSizeChange={setOutpaintTargetSize}
              compareMode={compareMode}
              uploading={uploading}
              fusionUploading={fusionSelection.loading}
              uploadDisabled={controller.formLocked || Boolean(edgeRefine)}
              refineMode={Boolean(edgeRefine)}
              onCompareModeChange={setCompareMode}
              onImageUpload={fusionTool ? (file) => { void handleFusionUpload('product', file) } : handleImageUpload}
              onReferenceImageUpload={(file) => { void handleFusionUpload('reference', file) }}
              onReady={handleCanvasReady}
              onMaskChange={setHasMaskPaint}
              uploadHint={activeTool.slug === 'remove' ? '上传后用画笔或智能选区涂抹要消除的区域' : undefined}
              onPreview={(view) => {
                const id = view === 'original' ? sourceAsset?.id : selectedResult?.id ?? sourceAsset?.id
                if (id) openAt(id)
              }}
            />
            <ImageAssetStrip
              assets={controller.outputAssets}
              selectedAssetId={controller.inputAsset?.id}
              downloadingAssetId={downloadingAssetId}
              onSelect={(assetId) => {
                controller.selectOutput(assetId)
                setCompareMode('effect')
              }}
              onDownload={(asset, index) => void handleDownload(asset, index)}
              onPreview={openAt}
            />
          </section>
          {showExample && example ? <ToolExampleStrip example={example} /> : null}
        </div>
        <aside className="workstation-panel image-workstation-settings" aria-labelledby="workstation-settings-heading">
          <h2 id="workstation-settings-heading" className="workstation-panel-heading">{activeTool.label}</h2>
          <CapabilityStatus
            ready={configurationReady}
            error={capabilityError}
            unavailableMessage={activeTool.slug === 'repaint'
              ? '重绘还不能用。请确认已开通万相 wanx2.1-imageedit，并配置 DASHSCOPE_API_KEY。'
              : `${COMING_SOON_SUBMIT_MESSAGE}。`}
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
              onResolutionChange={resolution => updateParameters({ resolution })}
              models={activeModels}
              modelProfileId={activeModelId}
              onModelProfileIdChange={relightTool ? setRelightModelId : variationTool ? setVariationModelId : setModelProfileId}
              sourceSize={controller.inputAsset ? { width: controller.inputAsset.width, height: controller.inputAsset.height } : undefined}
              disabled={controller.formLocked}
              erasePrompt={erasePrompt}
              onErasePromptChange={setErasePrompt}
              repaintPrompt={repaintPrompt}
              onRepaintPromptChange={setRepaintPrompt}
              outpaintMode={outpaintMode}
              onOutpaintModeChange={mode => {
                updateParameters({ outpaintMode: mode, ...(mode === 'free' ? { outpaintOutputMode: 'original' as const } : {}) })
              }}
              outpaintOutputMode={outpaintOutputMode}
              onOutpaintOutputModeChange={mode => {
                updateParameters({ outpaintOutputMode: mode, ...(mode === 'platform' ? { outpaintMode: 'preset' as const } : {}) })
              }}
              outpaintTargetSize={predictedOutpaintSize}
              presetPlatform={presetPlatform}
              onPresetPlatformChange={presetPlatform => updateParameters({ presetPlatform })}
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
            resultReadError={controller.resultReadError}
            historyError={controller.historyError}
            historySaved={controller.historySaved}
            onRetryRead={() => void controller.retryRead()}
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
          <span className="image-workstation-input-description" title={inputDescription}>{inputDescription}</span>
          <div className="image-workstation-footer-actions">
            {edgeRefine ? (
              <>
                <Button onClick={cancelEdgeRefine}>取消精修</Button>
                <Button type="primary" disabled={!controller.inputAsset} onClick={() => void finishEdgeRefine()}>完成精修</Button>
              </>
            ) : (
              <>
                <Button
                  icon={<DownloadOutlined />}
                  disabled={!selectedResult || controller.formLocked}
                  loading={Boolean(selectedResult && downloadingAssetId === selectedResult.id)}
                  onClick={() => void handleDownload(selectedResult, Math.max(0, controller.outputAssets.findIndex((asset) => asset.id === selectedResult?.id)))}
                >
                  下载结果
                </Button>
                <Tooltip title={blockReason}>
                  <span>
                    <CreditActionButton
                      type="primary"
                      loading={controller.submitting}
                      quote={generateQuote}
                      disabled={Boolean(blockReason) || controller.submitting || controller.inputPreparation?.phase === 'failed'}
                      onClick={handleGenerate}
                    >
                      {COUNT_TOOLS.includes(activeTool.slug as CountTool) ? `生成 ${effectiveParameters.count} 张` : '生成'}
                    </CreditActionButton>
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
        {!edgeRefine && <><CreditBalanceNotice quote={generateQuote} /><CreditSettlementHint quote={generateQuote} /></>}
      </div>
      <PreviewGallery {...galleryProps} onDownload={item => {
        const index = controller.outputAssets.findIndex(asset => asset.id === item.id)
        if (index >= 0) return handleDownload(controller.outputAssets[index], index)
      }} />
    </div>
  )
}
