import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageAsset } from '@/editor/types'
import { useImageWorkstationController } from '@/features/image-workstation/hooks/useImageWorkstationController'
import { getWorkstationTool } from '@/features/image-workstation/tools/registry'
import { uploadImage } from '@/services/api/upload'
import { Capability } from '@/types'
import CanvasArea, { type CanvasHandle } from './components/CanvasArea'
import ImageAssetStrip from './components/ImageAssetStrip'
import ParamPanel from './components/ParamPanel'
import ToolSidebar from './components/ToolSidebar'

export default function ImageWorkstation() {
  const { tool } = useParams<{ tool: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const canvasHandleRef = useRef<CanvasHandle | null>(null)
  const [sourceAsset, setSourceAsset] = useState<ImageAsset>()
  const [uploading, setUploading] = useState(false)
  const [compareMode, setCompareMode] = useState<'original' | 'effect'>('effect')
  const [smartEditPrompt, setSmartEditPrompt] = useState('')
  const [editCount, setEditCount] = useState(1)
  const [editResolution, setEditResolution] = useState<'2k' | '4k'>('2k')
  const [repaintPrompt, setRepaintPrompt] = useState('')
  const [outpaintMode, setOutpaintMode] = useState<'free' | 'preset'>('free')
  const [presetPlatform, setPresetPlatform] = useState(PLATFORM_SIZE_PRESETS[0].platform)
  const activeTool = getWorkstationTool(tool)
  const activePrompt = activeTool.capability === Capability.ImageEdit ? smartEditPrompt : repaintPrompt
  const controller = useImageWorkstationController({
    activeTool,
    initialAsset: sourceAsset,
    prompt: activePrompt,
    count: editCount,
    resolution: editResolution,
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
    if (task.status === 'succeeded') return `已生成 ${controller.outputAssets.length} 个图片结果`
    if (task.status === 'failed' || task.status === 'cancelled') return task.errorMessage || '任务没有完成，请重试'
    return '图片正在处理中，可以留在当前页面等待结果'
  }, [controller.activeTask, controller.outputAssets.length])

  const handleCanvasReady = useCallback((handle: CanvasHandle | null) => {
    canvasHandleRef.current = handle
  }, [])

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

  const handleGenerate = async () => {
    try {
      await controller.generate(canvasHandleRef.current)
      message.success('任务已提交')
    } catch (error) {
      const description = error instanceof Error ? error.message : '请检查 API 服务是否已启动'
      message.error({ content: `任务提交失败：${description}`, duration: 4 })
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
      <div className="image-workstation-main">
        <ToolSidebar activeSlug={activeTool.slug} onChange={(slug) => navigate(`/image-workstation/${slug}`)} />
        <div className="image-workstation-canvas-column">
          <CanvasArea
            interactionMode={activeTool.interactionMode}
            imageUrl={controller.inputAsset?.url}
            originalImageUrl={sourceAsset?.url}
            imageNaturalSize={inputSize}
            presetTargetSize={presetTargetSize}
            compareMode={compareMode}
            uploading={uploading}
            uploadDisabled={controller.formLocked}
            onCompareModeChange={setCompareMode}
            onImageUpload={handleImageUpload}
            onReady={handleCanvasReady}
          />
          <ImageAssetStrip
            assets={controller.outputAssets}
            selectedAssetId={controller.inputAsset?.id}
            onSelect={(assetId) => {
              controller.selectOutput(assetId)
              setCompareMode('effect')
            }}
          />
        </div>
        <aside className="image-workstation-settings">
          <ParamPanel
            capability={activeTool.capability}
            mode={inpaintMode}
            smartEditPrompt={smartEditPrompt}
            onSmartEditPromptChange={setSmartEditPrompt}
            count={editCount}
            onCountChange={setEditCount}
            resolution={editResolution}
            onResolutionChange={setEditResolution}
            disabled={controller.formLocked}
            repaintPrompt={repaintPrompt}
            onRepaintPromptChange={setRepaintPrompt}
            outpaintMode={outpaintMode}
            onOutpaintModeChange={setOutpaintMode}
            presetPlatform={presetPlatform}
            onPresetPlatformChange={setPresetPlatform}
          />
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
          {controller.inputAsset
            ? `${controller.inputAsset.name} · ${controller.inputAsset.width}×${controller.inputAsset.height}`
            : '请先上传需要处理的图片'}
        </div>
        <Button
          type="primary"
          loading={controller.submitting}
          disabled={!controller.inputAsset || controller.formLocked}
          onClick={handleGenerate}
        >
          生成
        </Button>
      </div>
    </div>
  )
}
