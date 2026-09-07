import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Button, Segmented, Upload } from 'antd'
import { InboxOutlined, UploadOutlined } from '@ant-design/icons'
import type { InteractionMode } from '../tools'
import BrushToolbar, { type PaintTool } from './canvas/BrushToolbar'
import type { MaskPaintCanvasHandle } from './canvas/MaskPaintCanvas'
import type { OutpaintCanvasHandle } from './canvas/OutpaintCanvas'

const MaskPaintCanvas = lazy(() => import('./canvas/MaskPaintCanvas'))
const OutpaintCanvas = lazy(() => import('./canvas/OutpaintCanvas'))

export type CanvasHandle = MaskPaintCanvasHandle | OutpaintCanvasHandle

interface Props {
  interactionMode: InteractionMode
  imageUrl?: string
  originalImageUrl?: string
  imageNaturalSize: { width: number; height: number }
  presetTargetSize?: { width: number; height: number }
  compareMode: 'original' | 'effect'
  uploading?: boolean
  uploadDisabled?: boolean
  onCompareModeChange: (mode: 'original' | 'effect') => void
  onImageUpload: (file: File) => void
  onReady: (handle: CanvasHandle | null) => void
}

const canvasShellStyle = {
  flex: 1,
  border: '1px dashed var(--color-border-strong)',
  borderRadius: 10,
  background: 'var(--color-canvas)',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  position: 'relative' as const,
  overflow: 'auto',
  minWidth: 0,
}

/** 根据交互模式装配真实画布或保留对应占位界面 */
export default function CanvasArea({
  interactionMode,
  imageUrl,
  originalImageUrl,
  imageNaturalSize,
  presetTargetSize,
  compareMode,
  uploading = false,
  uploadDisabled = false,
  onCompareModeChange,
  onImageUpload,
  onReady,
}: Props) {
  const maskHandleRef = useRef<MaskPaintCanvasHandle | null>(null)
  const [brushSize, setBrushSize] = useState(28)
  const [paintTool, setPaintTool] = useState<PaintTool>('brush')
  const [smartSelectEnabled, setSmartSelectEnabled] = useState(false)
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
  }, [imageUrl, interactionMode, onReady])

  const interceptUpload = (file: File) => {
    onImageUpload(file)
    return Upload.LIST_IGNORE
  }

  if (!imageUrl) {
    return (
      <div style={canvasShellStyle}>
        <Upload.Dragger
          className="workstation-upload"
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          disabled={uploading || uploadDisabled}
          beforeUpload={interceptUpload}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">上传需要处理的商品图片</p>
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
      <div style={canvasShellStyle}>
        <div style={{ position: 'absolute', top: 12, zIndex: 3 }}>
          <BrushToolbar
            brushSize={brushSize}
            tool={paintTool}
            smartSelectEnabled={smartSelectEnabled}
            canUndo={historyState.canUndo}
            canRedo={historyState.canRedo}
            onBrushSizeChange={setBrushSize}
            onToolChange={selectPaintTool}
            onSmartSelectToggle={() => setSmartSelectEnabled((enabled) => !enabled)}
            onUndo={() => maskHandleRef.current?.undo()}
            onRedo={() => maskHandleRef.current?.redo()}
            onClear={() => maskHandleRef.current?.clear()}
          />
        </div>
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 4 }}>{replaceButton}</div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载蒙版画布…</div>}>
          <MaskPaintCanvas
            ref={setMaskHandle}
            imageUrl={imageUrl}
            brushSize={brushSize}
            tool={paintTool}
            smartSelectEnabled={smartSelectEnabled}
            onHistoryChange={setHistoryState}
          />
        </Suspense>
        {smartSelectEnabled ? (
          <div style={{ position: 'absolute', bottom: 12, color: 'var(--color-text-secondary)', fontSize: 12 }}>
            点击商品主体以创建智能选区
          </div>
        ) : null}
      </div>
    )
  }

  if (interactionMode === 'drag-resize') {
    return (
      <div style={canvasShellStyle}>
        <div style={{ position: 'absolute', top: 12, zIndex: 3, color: 'var(--color-text-secondary)', fontSize: 12 }}>
          {presetTargetSize ? '已按平台预设自动居中' : '拖拽绿色边框的控制点调整扩图范围'}
        </div>
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 4 }}>{replaceButton}</div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载扩图画布…</div>}>
          <OutpaintCanvas
            ref={setOutpaintHandle}
            imageUrl={imageUrl}
            imageNaturalSize={imageNaturalSize}
            presetTargetSize={presetTargetSize}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div style={canvasShellStyle}>
      <div style={{ position: 'absolute', top: 12 }}>
        <Segmented
          value={compareMode}
          options={[{ label: '原图', value: 'original' }, { label: '效果', value: 'effect' }]}
          onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
        />
      </div>
      <div style={{ position: 'absolute', top: 12, right: 12 }}>{replaceButton}</div>
      <img
        src={compareMode === 'original' ? originalImageUrl ?? imageUrl : imageUrl}
        alt={compareMode === 'original' ? '原始图片' : '当前编辑效果'}
        style={{ maxWidth: '72%', maxHeight: '72%', objectFit: 'contain' }}
      />
      <div style={{ position: 'absolute', bottom: 12, color: 'var(--color-text-muted)', fontSize: 12 }}>
        {interactionMode === 'params-only' ? '选择候选结果后，可基于该结果继续编辑' : '当前工具将在后续迭代中开放'}
      </div>
    </div>
  )
}
