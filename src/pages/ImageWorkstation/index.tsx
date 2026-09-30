import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { DownloadOutlined } from '@ant-design/icons'
import { App, Button, Tooltip } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewGallery, { type PreviewItem } from '@/components/PreviewGallery'
import ToolSwitcher from '@/components/ToolSwitcher'
import { usePreviewGallery } from '@/components/usePreviewGallery'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import type { ImageAsset } from '@/editor/types'
import { useImageWorkstationController } from '@/features/image-workstation/hooks/useImageWorkstationController'
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
import { loadImageEditConfigured, loadRepaintConfigured, loadVariationConfigured } from '@/services/api/capabilities'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import { liveCapabilityReady } from '@/services/api/task'
import { defaultImageModel, publicImageModel, IMAGE_MODEL_PROFILES } from '@shared/image-models'
import { RELIGHT_DEFAULT, type RelightOptions } from '@shared/relight'
import { normalizeRetouchDirections, type RetouchDirection } from '@shared/retouch'
import { uploadImage } from '@/services/api/upload'
import { Capability } from '@/types'
import { downloadFailureMessage, downloadImageAsset, filenameForWorkstationResult } from '@/features/image-workstation/download'
import CanvasArea, { type CanvasHandle } from './components/CanvasArea'
import ImageAssetStrip from './components/ImageAssetStrip'
import ParamPanel from './components/ParamPanel'
import { workstationGenerateBlockReason } from './utils/generateGate'

export default function ImageWorkstation() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const project = useEditorStore(state => state.project)
  const canvasHandleRef = useRef<CanvasHandle | null>(null)
  const [sourceAsset, setSourceAsset] = useState<ImageAsset>()
  const [uploading, setUploading] = useState(false)
  const [compareMode, setCompareMode] = useState<'original' | 'effect'>('effect')
  const [smartEditPrompt, setSmartEditPrompt] = useState('')
  const [variationPrompt, setVariationPrompt] = useState('')
  const [retouchNote, setRetouchNote] = useState('')
  const [fusionNote, setFusionNote] = useState('')
  const [retouchDirections, setRetouchDirections] = useState<RetouchDirection[]>([])
  const [fusionProduct, setFusionProduct] = useState<ImageAsset>()
  const [fusionReference, setFusionReference] = useState<ImageAsset>()
  const [editCount, setEditCount] = useState(1)
  const [variationCount, setVariationCount] = useState(2)
  const [retouchCount, setRetouchCount] = useState(1)
  const [fusionCount, setFusionCount] = useState(1)
  const [relightCount, setRelightCount] = useState(2)
  const [relightNote, setRelightNote] = useState('')
  const [relightOptions, setRelightOptions] = useState<RelightOptions>(RELIGHT_DEFAULT)
  const [editResolution, setEditResolution] = useState<'1k' | '2k' | '4k'>('2k')
  const [imageModels, setImageModels] = useState<PublicImageModel[]>(() =>
    IMAGE_MODEL_PROFILES.filter(profile => profile.operations.includes('image_edit')).map(publicImageModel))
  const [variationModels, setVariationModels] = useState<PublicImageModel[]>(() =>
    IMAGE_MODEL_PROFILES.filter(profile => profile.operations.includes('variation')).map(publicImageModel))
  const [modelProfileId, setModelProfileId] = useState(() => defaultImageModel('image_edit')?.id)
  const [variationModelId, setVariationModelId] = useState(() => defaultImageModel('variation')?.id)
  const [erasePrompt, setErasePrompt] = useState('')
  const [repaintPrompt, setRepaintPrompt] = useState('')
  const [outpaintMode, setOutpaintMode] = useState<'free' | 'preset'>('free')
  const [presetPlatform, setPresetPlatform] = useState(PLATFORM_SIZE_PRESETS[0].platform)
  const [edgeRefine, setEdgeRefine] = useState<EdgeRefineHandoff | null>(null)
  const [repaintReady, setRepaintReady] = useState(() => liveCapabilityReady(Capability.Inpaint))
  const [imageEditReady, setImageEditReady] = useState(() => liveCapabilityReady(Capability.ImageEdit))
  const [variationReady, setVariationReady] = useState(() => liveCapabilityReady(Capability.Variation))
  const [hasMaskPaint, setHasMaskPaint] = useState(false)
  const [downloadingAssetId, setDownloadingAssetId] = useState<string>()
  const edgeRefineFinishedRef = useRef(false)
  const activeTool = getWorkstationTool(tool)
  const capabilityReady = useCallback((capability: Capability) => {
    if (capability === Capability.ImageEdit || capability === Capability.Retouch || capability === Capability.Fusion || capability === Capability.Relight) return imageEditReady
    if (capability === Capability.Variation) return variationReady
    return liveCapabilityReady(capability)
  }, [imageEditReady, variationReady])
  const toolReady = isWorkstationToolReady(activeTool, capabilityReady)
  const showSourcePreview = workstationDisplaysSourcePreview(activeTool.interactionMode)
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
  const activeCount = relightTool ? relightCount : fusionTool ? fusionCount : retouchTool ? retouchCount : variationTool ? variationCount : editCount
  const activeModelId = variationTool ? variationModelId : modelProfileId
  const activeModels = variationTool ? variationModels : imageModels
  const controller = useImageWorkstationController({
    activeTool,
    initialAsset: fusionTool ? fusionProduct : sourceAsset,
    prompt: activePrompt,
    count: activeCount,
    resolution: editResolution,
    modelProfileId: activeModelId,
    capabilityReady,
    retouchDirections,
    relight: relightOptions,
    productAsset: fusionProduct,
    referenceAsset: fusionReference,
    useProductAsset: fusionTool,
  })
  const replaceSourceAsset = controller.replaceSourceAsset

  const inpaintMode = activeTool.slug === 'repaint' ? 'repaint' : activeTool.slug === 'remove' ? 'remove' : undefined
  const selectedPreset = PLATFORM_SIZE_PRESETS.find((preset) => preset.platform === presetPlatform)
  const presetTargetSize = outpaintMode === 'preset' && selectedPreset
    ? { width: selectedPreset.width, height: selectedPreset.height }
    : undefined
  const taskSummary = useMemo(() => {
    const task = controller.activeTask
    if (!task) return undefined
    if (controller.protocolError) return undefined
    if (task.status === 'succeeded') {
      if (controller.outputAssets.length === 0) return undefined
      return `已生成 ${controller.outputAssets.length} 个图片结果`
    }
    if (task.status === 'failed' || task.status === 'cancelled') return task.errorMessage || '任务没有完成，请重试'
    return '图片正在处理中，可以留在当前页面等待结果'
  }, [controller.activeTask, controller.outputAssets.length, controller.protocolError])
  const selectedResult = controller.outputAssets.find((asset) => asset.id === controller.inputAsset?.id)
    ?? controller.outputAssets[0]
  const previewItems: PreviewItem[] = controller.outputAssets.map(asset => {
    const generation = Object.values(project?.generations ?? {}).find(job => job.outputAssetIds.includes(asset.id))
    const source = generation?.inputAssetIds[0] ? project?.assets[generation.inputAssetIds[0]] : undefined
    return {
      id: asset.id,
      thumbSrc: asset.url,
      fullSrc: asset.url,
      originalSrc: source?.type === 'image' ? source.url : undefined,
      title: asset.name,
      meta: { tool: activeTool.label, resolution: `${asset.width}×${asset.height}` },
    }
  })
  const { openAt, galleryProps } = usePreviewGallery(previewItems)
  const maskRequired = Boolean(inpaintMode) && !edgeRefine
  const generateBlockReason = workstationGenerateBlockReason({
    toolReady,
    hasInput: fusionTool ? Boolean(fusionProduct && fusionReference) : Boolean(controller.inputAsset),
    formLocked: controller.formLocked,
    submitting: controller.submitting,
    maskRequired,
    hasMaskPaint,
    repaintBlocked: activeTool.slug === 'repaint' && !repaintReady,
    retouchBlocked: retouchTool && normalizeRetouchDirections(retouchDirections).length === 0,
    fusionBlocked: fusionTool && (!fusionProduct || !fusionReference),
    mode: inpaintMode,
  })

  const handleCanvasReady = useCallback((handle: CanvasHandle | null) => {
    canvasHandleRef.current = handle
  }, [])

  const handleFusionUpload = useCallback(async (slot: 'product' | 'reference', file: File) => {
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
      if (slot === 'product') setFusionProduct(asset)
      else setFusionReference(asset)
      message.success(slot === 'product' ? '商品图已上传' : '场景图已上传')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '图片上传失败')
    } finally {
      setUploading(false)
    }
  }, [message])

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
  uploadRef.current = handleImageUpload

  useEffect(() => {
    let active = true
    void loadRepaintConfigured().then(ready => { if (active) setRepaintReady(ready) })
    void loadImageEditConfigured().then(ready => { if (active) setImageEditReady(ready) })
    void loadVariationConfigured().then(ready => { if (active) setVariationReady(ready) })
    void listImageModels('image_edit').then(items => {
      if (!active || !items.length) return
      setImageModels(items)
      setModelProfileId(current => items.some(item => item.id === current)
        ? current
        : (items.find(item => item.defaultFor?.includes('image_edit')) ?? items[0]).id)
    }).catch(() => undefined)
    void listImageModels('variation').then(items => {
      if (!active || !items.length) return
      setVariationModels(items)
      setVariationModelId(current => items.some(item => item.id === current)
        ? current
        : (items.find(item => item.defaultFor?.includes('variation')) ?? items[0]).id)
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (activeTool.slug !== 'outpaint') return
    const handoff = takeOutpaintHandoff()
    if (!handoff) return
    const preset = presetForHandoff(handoff.presetId)
    if (preset) {
      setOutpaintMode('preset')
      setPresetPlatform(preset.platform)
    }
    let active = true
    void uploadRef.current(handoff.file).finally(() => {
      if (!active) setOutpaintHandoff(handoff)
    })
    return () => { active = false }
  }, [activeTool.slug])

  useEffect(() => {
    if (activeTool.slug !== 'remove') {
      clearEdgeRefineHandoff()
      setEdgeRefine(null)
      return
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
    setSourceAsset(asset)
    replaceSourceAsset(asset)
    setEdgeRefine(handoff)
    return () => {
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
    try {
      await controller.retry()
      message.success('已按原参数重新提交')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务重试失败')
    }
  }

  const inputSize = controller.inputAsset
    ? { width: controller.inputAsset.width, height: controller.inputAsset.height }
    : { width: 0, height: 0 }

  return (
    <div className="image-workstation-page">
      <ToolSwitcher
        className="image-workstation-tool-switcher"
        options={WORKSTATION_TOOLS.map((item) => ({
          value: item.slug,
          label: item.label,
          ready: isWorkstationToolReady(item, capabilityReady),
        }))}
        value={activeTool.slug}
        onChange={(slug) => navigate(`/image-workstation/${slug}`)}
      />
      <div className="image-workstation-main">
        <div className="image-workstation-canvas-column">
          <CanvasArea
            interactionMode={activeTool.interactionMode}
            imageUrl={fusionTool ? fusionProduct?.url : showSourcePreview ? controller.inputAsset?.url : undefined}
            referenceImageUrl={fusionTool ? fusionReference?.url : undefined}
            originalImageUrl={showSourcePreview ? sourceAsset?.url : undefined}
            imageNaturalSize={inputSize}
            presetTargetSize={presetTargetSize}
            compareMode={compareMode}
            uploading={uploading}
            uploadDisabled={controller.formLocked || Boolean(edgeRefine)}
            refineMode={Boolean(edgeRefine)}
            onCompareModeChange={setCompareMode}
            onImageUpload={fusionTool ? (file) => { void handleFusionUpload('product', file) } : handleImageUpload}
            onReferenceImageUpload={(file) => { void handleFusionUpload('reference', file) }}
            onReady={handleCanvasReady}
            onMaskChange={setHasMaskPaint}
            onPreview={selectedResult ? () => openAt(selectedResult.id) : undefined}
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
          <PreviewGallery {...galleryProps} onDownload={item => {
            const index = controller.outputAssets.findIndex(asset => asset.id === item.id)
            if (index >= 0) return handleDownload(controller.outputAssets[index], index)
          }} />
        </div>
        <aside className="image-workstation-settings">
          {toolReady ? (
            <ParamPanel
              capability={activeTool.capability}
              mode={inpaintMode}
              smartEditPrompt={relightTool ? relightNote : fusionTool ? fusionNote : retouchTool ? retouchNote : variationTool ? variationPrompt : smartEditPrompt}
              onSmartEditPromptChange={relightTool ? setRelightNote : fusionTool ? setFusionNote : retouchTool ? setRetouchNote : variationTool ? setVariationPrompt : setSmartEditPrompt}
              count={activeCount}
              onCountChange={relightTool ? setRelightCount : fusionTool ? setFusionCount : retouchTool ? setRetouchCount : variationTool ? setVariationCount : setEditCount}
              relight={relightOptions}
              onRelightChange={setRelightOptions}
              retouchDirections={retouchDirections}
              onRetouchDirectionsChange={setRetouchDirections}
              resolution={editResolution}
              onResolutionChange={setEditResolution}
              models={activeModels}
              modelProfileId={activeModelId}
              onModelProfileIdChange={variationTool ? setVariationModelId : setModelProfileId}
              sourceSize={controller.inputAsset ? { width: controller.inputAsset.width, height: controller.inputAsset.height } : undefined}
              disabled={controller.formLocked}
              erasePrompt={erasePrompt}
              onErasePromptChange={setErasePrompt}
              repaintPrompt={repaintPrompt}
              onRepaintPromptChange={setRepaintPrompt}
              repaintReady={repaintReady}
              outpaintMode={outpaintMode}
              onOutpaintModeChange={setOutpaintMode}
              presetPlatform={presetPlatform}
              onPresetPlatformChange={setPresetPlatform}
            />
          ) : (
            <p className="toolbox-hint toolbox-warning">{COMING_SOON_SUBMIT_MESSAGE}。</p>
          )}
          <GenerationTaskStatus
            task={controller.activeTask}
            submitting={controller.submitting}
            active={controller.active}
            polling={controller.polling}
            summary={taskSummary}
            submissionError={controller.submissionError}
            protocolError={controller.protocolError}
            pollError={controller.pollError}
            onRetry={() => void handleRetry()}
            onModifyParameters={controller.modifyParameters}
            onRefetch={() => void controller.refetch()}
          />
        </aside>
      </div>
      <div className="image-workstation-footer">
        <div>
          {fusionTool
            ? `${fusionProduct ? `商品 ${fusionProduct.width}×${fusionProduct.height}` : '请上传商品图'} · ${fusionReference ? `场景 ${fusionReference.width}×${fusionReference.height}` : '请上传场景图'}`
            : !showSourcePreview
            ? '当前工具即将上线，不会使用上一工具的图片'
            : controller.inputAsset
              ? `${controller.inputAsset.name} · ${controller.inputAsset.width}×${controller.inputAsset.height}`
              : '请先上传需要处理的图片'}
        </div>
        {edgeRefine ? (
          <>
            <Button onClick={cancelEdgeRefine}>取消精修</Button>
            <Button type="primary" disabled={!controller.inputAsset} onClick={() => void finishEdgeRefine()}>完成精修</Button>
          </>
        ) : (
          <div className="image-workstation-footer-actions">
            <Button
              icon={<DownloadOutlined />}
              disabled={!selectedResult || controller.formLocked}
              loading={Boolean(selectedResult && downloadingAssetId === selectedResult.id)}
              onClick={() => void handleDownload(selectedResult, Math.max(0, controller.outputAssets.findIndex((asset) => asset.id === selectedResult?.id)))}
            >
              下载结果
            </Button>
            <Tooltip title={generateBlockReason}>
              <span>
                <Button
                  type="primary"
                  loading={controller.submitting}
                  disabled={Boolean(generateBlockReason)}
                  onClick={handleGenerate}
                >
                  生成
                </Button>
              </span>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  )
}
