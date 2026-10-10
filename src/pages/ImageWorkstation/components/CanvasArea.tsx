import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Segmented, Upload, message } from 'antd'
import { InboxOutlined, UploadOutlined } from '@ant-design/icons'
import { lazyWithRetry } from '@/utils/lazyWithRetry'
import { useCapabilities } from '@/hooks/useCapabilities'
import type { InteractionMode } from '../tools'
import BrushToolbar, { type PaintTool } from './canvas/BrushToolbar'
import type { MaskPaintCanvasHandle } from './canvas/MaskPaintCanvas'
import type { OutpaintCanvasHandle } from './canvas/OutpaintCanvas'
import type { OutpaintOutputMode } from '@shared/outpaint'

const MaskPaintCanvas = lazyWithRetry(() => import('./canvas/MaskPaintCanvas'))
const OutpaintCanvas = lazyWithRetry(() => import('./canvas/OutpaintCanvas'))

export type CanvasHandle = MaskPaintCanvasHandle | OutpaintCanvasHandle

interface Props {
  interactionMode: InteractionMode
  imageUrl?: string
  imageObjectKey?: string
  referenceImageUrl?: string
  originalImageUrl?: string
  imageNaturalSize: { width: number; height: number }
  presetTargetSize?: { width: number; height: number }
  outpaintOutputMode?: OutpaintOutputMode
  onOutpaintTargetSizeChange?: (size: { width: number; height: number }) => void
  compareMode: 'original' | 'effect'
  uploading?: boolean
  fusionUploading?: { product: boolean; reference: boolean }
  uploadDisabled?: boolean
  refineMode?: boolean
  onCompareModeChange: (mode: 'original' | 'effect') => void
  onImageUpload: (file: File) => void
  onReferenceImageUpload?: (file: File) => void
  onReady: (handle: CanvasHandle | null) => void
  onMaskChange?: (hasPaint: boolean) => void
  onPreview?: (view: 'original' | 'effect') => void
  uploadHint?: string
}

const canvasShellClass = 'workstation-canvas-shell'

function FusionSlot({
  label,
  hint,
  imageUrl,
  uploading,
  disabled,
  onUpload,
}: {
  label: string
  hint: string
  imageUrl?: string
  uploading: boolean
  disabled: boolean
  onUpload: (file: File) => void
}) {
  const beforeUpload = (file: File) => {
    onUpload(file)
    return Upload.LIST_IGNORE
  }
  return (
    <div className="workstation-fusion-slot">
      <div className="workstation-fusion-slot-label">{label}</div>
      {imageUrl ? (
        <>
          <img src={imageUrl} alt={label} />
          <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} disabled={uploading || disabled} beforeUpload={beforeUpload}>
            <Button size="small" icon={<UploadOutlined />} disabled={disabled} loading={uploading}>替换</Button>
          </Upload>
        </>
      ) : (
        <Upload.Dragger
          className="workstation-upload"
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          disabled={uploading || disabled}
          beforeUpload={beforeUpload}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">上传{label}</p>
          <p className="ant-upload-hint">{hint}。支持 PNG、JPEG、WebP，单张不超过 20 MB</p>
        </Upload.Dragger>
      )}
    </div>
  )
}

/** 根据交互模式装配真实画布或保留对应占位界面 */
export default function CanvasArea({
  interactionMode,
  imageUrl,
  imageObjectKey,
  referenceImageUrl,
  originalImageUrl,
  imageNaturalSize,
  presetTargetSize,
  outpaintOutputMode,
  onOutpaintTargetSizeChange,
  compareMode,
  uploading = false,
  fusionUploading,
  uploadDisabled = false,
  refineMode = false,
  onCompareModeChange,
  onImageUpload,
  onReferenceImageUpload,
  onReady,
  onMaskChange,
  onPreview,
  uploadHint,
}: Props) {
  const maskHandleRef = useRef<MaskPaintCanvasHandle | null>(null)
  const [brushSize, setBrushSize] = useState(28)
  const [paintTool, setPaintTool] = useState<PaintTool>('brush')
  const [smartSelectEnabled, setSmartSelectEnabled] = useState(false)
  const { capabilities: { smartSelect: smartSelectReady }, error: capabilityError } = useCapabilities()
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  const setMaskHandle = useCallback(
    (handle: MaskPaintCanvasHandle | null) => {
      maskHandleRef.current = handle
      onReady(handle)
    },
    [onReady],
  )

  const setOutpaintHandle = useCallback(
    (handle: OutpaintCanvasHandle | null) => {
      onReady(handle)
    },
    [onReady],
  )

  useEffect(() => {
    if (!imageUrl || (interactionMode !== 'mask-paint' && interactionMode !== 'drag-resize')) onReady(null)
    if (interactionMode !== 'mask-paint') onMaskChange?.(false)
  }, [imageUrl, interactionMode, onMaskChange, onReady])

  const interceptUpload = (file: File) => {
    onImageUpload(file)
    return Upload.LIST_IGNORE
  }

  if (interactionMode === 'multi-source') {
    return (
      <div className={`${canvasShellClass}${!imageUrl && !referenceImageUrl ? ' is-empty' : ''}`}>
        <div className="workstation-fusion-sources">
          <FusionSlot
            label="商品"
            hint="要保留的商品图"
            imageUrl={imageUrl}
            uploading={fusionUploading?.product ?? uploading}
            disabled={uploadDisabled}
            onUpload={onImageUpload}
          />
          <FusionSlot
            label="场景或参考"
            hint="提供背景或参考的图"
            imageUrl={referenceImageUrl}
            uploading={fusionUploading?.reference ?? uploading}
            disabled={uploadDisabled}
            onUpload={onReferenceImageUpload ?? onImageUpload}
          />
        </div>
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div className={`${canvasShellClass} is-empty`}>
        <Upload.Dragger
          className="workstation-upload"
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          disabled={uploading || uploadDisabled}
          beforeUpload={interceptUpload}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">上传需要处理的商品图片</p>
          {uploadHint ? <p className="ant-upload-hint">{uploadHint}</p> : null}
          <p className="ant-upload-hint">支持 PNG、JPEG、WebP，单张不超过 20 MB</p>
        </Upload.Dragger>
      </div>
    )
  }

  const replaceButton = (
    <Upload
      accept="image/png,image/jpeg,image/webp"
      showUploadList={false}
      disabled={uploading || uploadDisabled}
      beforeUpload={interceptUpload}
    >
      <Button size="small" icon={<UploadOutlined />} loading={uploading}>替换图片</Button>
    </Upload>
  )

  const selectPaintTool = (tool: PaintTool) => {
    setPaintTool(tool)
    setSmartSelectEnabled(false)
  }

  if (interactionMode === 'mask-paint') {
    return (
      <div className={canvasShellClass}>
        <div className="workstation-canvas-controls">
          <div className="workstation-canvas-toolbar">
            <BrushToolbar
              brushSize={brushSize}
              tool={paintTool}
              smartSelectEnabled={smartSelectEnabled}
              smartSelectReady={smartSelectReady}
              smartSelectError={Boolean(capabilityError)}
              refineMode={refineMode}
              canUndo={historyState.canUndo}
              canRedo={historyState.canRedo}
              onBrushSizeChange={setBrushSize}
              onToolChange={selectPaintTool}
              onSmartSelectToggle={() => setSmartSelectEnabled((enabled) => !enabled)}
              onInvert={() => {
                void maskHandleRef.current?.invertSelection().catch(error => {
                  message.error(error instanceof Error ? error.message : '反选失败')
                })
              }}
              onUndo={() => maskHandleRef.current?.undo()}
              onRedo={() => maskHandleRef.current?.redo()}
              onClear={() => maskHandleRef.current?.clear()}
            />
          </div>
          {!refineMode && <div className="workstation-canvas-replace">{replaceButton}</div>}
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载蒙版画布…</div>}>
          <MaskPaintCanvas
            ref={setMaskHandle}
            imageUrl={imageUrl}
            imageObjectKey={imageObjectKey}
            imageNaturalSize={imageNaturalSize}
            brushSize={brushSize}
            tool={paintTool}
            smartSelectEnabled={smartSelectEnabled}
            refineMode={refineMode}
            onHistoryChange={setHistoryState}
            onMaskChange={onMaskChange}
          />
        </Suspense>
        {smartSelectEnabled ? (
          <div className="workstation-canvas-footnote">点击商品以选中轮廓。水印、文字和道具请用画笔。</div>
        ) : null}
      </div>
    )
  }

  if (interactionMode === 'drag-resize') {
    return (
      <div className={canvasShellClass}>
        <div className="workstation-canvas-controls">
          <div className="workstation-canvas-hint">
            {presetTargetSize ? '已按平台预设自动居中' : '拖拽绿色边框的控制点调整扩图范围'}
          </div>
          <div className="workstation-canvas-replace">{replaceButton}</div>
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载扩图画布…</div>}>
          <OutpaintCanvas
            ref={setOutpaintHandle}
            imageUrl={imageUrl}
            imageNaturalSize={imageNaturalSize}
            presetTargetSize={presetTargetSize}
            outputMode={outpaintOutputMode}
            onTargetSizeChange={onOutpaintTargetSizeChange}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div className={canvasShellClass}>
      <div className="workstation-canvas-controls">
        <div className="workstation-canvas-toolbar">
          <Segmented
            value={compareMode}
            options={[{ label: '原图', value: 'original' }, { label: '效果', value: 'effect' }]}
            onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
          />
        </div>
        <div className="workstation-canvas-replace">{replaceButton}</div>
      </div>
      <img
        src={compareMode === 'original' ? originalImageUrl ?? imageUrl : imageUrl}
        alt={compareMode === 'original' ? '原始图片' : '当前编辑效果'}
        className={`workstation-preview-image${onPreview ? ' is-previewable' : ''}`}
        onClick={onPreview ? () => onPreview(compareMode) : undefined}
      />
      <div className="workstation-canvas-footnote">
        {interactionMode === 'params-only' ? '选择候选结果后，可基于该结果继续编辑' : '当前工具将在后续迭代中开放'}
      </div>
    </div>
  )
}
