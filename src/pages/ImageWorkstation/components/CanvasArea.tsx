import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Segmented, Spin, Upload, message } from 'antd'
import { BulbOutlined, HistoryOutlined, InboxOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons'
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
  /** 涂抹类工具：已有结果时用于「原图/效果」对比。 */
  resultImageUrl?: string
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
  /** 融合：单张图片载入失败时的槽位内联提示。 */
  fusionErrors?: { product?: string; reference?: string }
  /** 融合：点击槽位图片打开大图。 */
  onPreviewImage?: (role: 'product' | 'reference') => void
  uploadDisabled?: boolean
  /** 生成中锁定涂抹，但仍允许上传按钮沿用 uploadDisabled 的独立判断。 */
  paintDisabled?: boolean
  refineMode?: boolean
  onCompareModeChange: (mode: 'original' | 'effect') => void
  onImageUpload: (file: File) => void
  onReferenceImageUpload?: (file: File) => void
  /** 融合：两张图都就绪时交换商品与场景角色。 */
  onSwapImages?: () => void
  /** 融合：移除单个槽位。 */
  onRemoveImage?: (role: 'product' | 'reference') => void
  /** 融合：最近一次用过的场景图，空场景槽位可一键复用。 */
  lastScene?: { name: string; width: number; height: number }
  onReuseLastScene?: () => void
  reusingLastScene?: boolean
  onReady: (handle: CanvasHandle | null) => void
  onMaskChange?: (hasPaint: boolean) => void
  onPreview?: (view: 'original' | 'effect') => void
  uploadHint?: string
  activityLabel?: string
  /** 已有输入图时在画布上显示生成状态，不替换图片。 */
  processingLabel?: string
  /** 结果读取失败时在画布上显示失败状态。 */
  errorLabel?: string
  /** 叠加在画布上的方向示意等交互层。 */
  overlay?: ReactNode
  /** 空状态上传框上方的教学示意，避免把示例推到首屏之外。 */
  emptyExtra?: ReactNode
  /** 画布工具条上的叠加层开关。 */
  overlayToggle?: { label: string; pressed: boolean; onChange: () => void }
  /** 叠加层开关旁的指针操作提示。 */
  overlayHint?: string
  /** 没有结果时隐藏原图/效果对比，只保留当前预览。 */
  compareAvailable?: boolean
  /** 覆盖画布底部说明；传 null 隐藏说明。 */
  footnote?: string | null
}

const canvasShellClass = 'workstation-canvas-shell'

function FusionSlot({
  label,
  hint,
  imageUrl,
  uploading,
  disabled,
  error,
  onPreviewImage,
  onUpload,
  onRemove,
  lastScene,
  onReuseLastScene,
  reusingLastScene,
}: {
  label: string
  hint: string
  imageUrl?: string
  uploading: boolean
  disabled: boolean
  error?: string
  onPreviewImage?: () => void
  onUpload: (file: File) => void
  onRemove?: () => void
  lastScene?: { name: string; width: number; height: number }
  onReuseLastScene?: () => void
  reusingLastScene?: boolean
}) {
  const beforeUpload = (file: File) => {
    onUpload(file)
    return Upload.LIST_IGNORE
  }
  return (
    <div className="workstation-fusion-slot" aria-busy={uploading || undefined}>
      <div className="workstation-fusion-slot-label">{label}</div>
      {imageUrl ? (
        <>
          {onPreviewImage ? (
            <button
              type="button"
              className="workstation-fusion-slot-image"
              title={`查看${label}大图`}
              aria-label={`查看${label}大图`}
              onClick={onPreviewImage}
            >
              <img src={imageUrl} alt={label} />
            </button>
          ) : <img src={imageUrl} alt={label} />}
          <div className="workstation-fusion-slot-actions">
            <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} disabled={uploading || disabled} beforeUpload={beforeUpload}>
              <Button size="small" icon={<UploadOutlined />} disabled={disabled} loading={uploading} aria-label={`替换${label}`}>替换</Button>
            </Upload>
            {onRemove ? (
              <Button size="small" type="text" danger disabled={disabled || uploading} aria-label={`移除${label}`} onClick={onRemove}>移除</Button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <Upload.Dragger
            className="workstation-upload"
            accept="image/png,image/jpeg,image/webp"
            showUploadList={false}
            disabled={uploading || disabled}
            beforeUpload={beforeUpload}
          >
            <div className="ant-upload-drag-icon">{uploading ? <Spin /> : <InboxOutlined />}</div>
            <p className="ant-upload-text">{uploading ? `正在载入${label}…` : `上传${label}`}</p>
            {uploading ? null : <p className="ant-upload-hint">{hint}。支持 PNG、JPEG、WebP，单张不超过 20 MB</p>}
          </Upload.Dragger>
          {!uploading && lastScene && onReuseLastScene ? (
            <Button
              className="workstation-fusion-last-scene"
              size="small"
              type="link"
              icon={<HistoryOutlined />}
              loading={reusingLastScene}
              disabled={disabled}
              title={`使用上次场景：${lastScene.name}`}
              aria-label={`使用上次场景 ${lastScene.width}×${lastScene.height}`}
              onClick={onReuseLastScene}
            >
              使用上次场景
              <span className="workstation-fusion-last-scene-meta">{lastScene.width}×{lastScene.height}</span>
            </Button>
          ) : null}
        </>
      )}
      {error ? (
        <div className="workstation-fusion-slot-error" role="alert">{error}</div>
      ) : null}
    </div>
  )
}

/** 根据交互模式装配真实画布或保留对应占位界面 */
export default function CanvasArea({
  interactionMode,
  imageUrl,
  resultImageUrl,
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
  fusionErrors,
  onPreviewImage,
  uploadDisabled = false,
  paintDisabled = false,
  refineMode = false,
  onCompareModeChange,
  onImageUpload,
  onReferenceImageUpload,
  onSwapImages,
  onRemoveImage,
  lastScene,
  onReuseLastScene,
  reusingLastScene,
  onReady,
  onMaskChange,
  onPreview,
  uploadHint,
  activityLabel,
  processingLabel,
  errorLabel,
  overlay,
  emptyExtra,
  overlayToggle,
  overlayHint,
  compareAvailable = true,
  footnote,
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

  if (activityLabel && !imageUrl && !referenceImageUrl) {
    return (
      <div className={`${canvasShellClass} is-empty`}>
        <div className="workstation-task-placeholder" role="status">
          <Spin />
          <p>{activityLabel}</p>
        </div>
      </div>
    )
  }

  if (interactionMode === 'multi-source') {
    // 有结果时主舞台默认展示效果，输入槽位收进「输入」视图，避免结果只出现在下方缩略条。
    const viewingResult = compareAvailable && compareMode === 'effect' && Boolean(resultImageUrl)
    return (
      <div className={`${canvasShellClass}${!imageUrl && !referenceImageUrl && !viewingResult ? ' is-empty' : ''}`}>
        {compareAvailable ? (
          <div className="workstation-canvas-controls">
            <div className="workstation-canvas-toolbar">
              <Segmented
                aria-label="切换融合输入与效果"
                value={compareMode}
                options={[{ label: '输入', value: 'original' }, { label: '效果', value: 'effect' }]}
                onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
              />
            </div>
          </div>
        ) : null}
        {viewingResult ? (
          <div className="workstation-preview-stage">
            <img
              src={resultImageUrl}
              alt="融合结果"
              className={`workstation-preview-image${onPreview ? ' is-previewable' : ''}`}
              tabIndex={onPreview ? 0 : undefined}
              role={onPreview ? 'button' : undefined}
              aria-label={onPreview ? '打开融合结果大图' : undefined}
              onClick={onPreview ? () => onPreview('effect') : undefined}
              onKeyDown={onPreview ? event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onPreview('effect')
              } : undefined}
            />
          </div>
        ) : (
          <div className="workstation-fusion-sources">
            <FusionSlot
              label="商品"
              hint="要保留的商品图，商品本身不会改变"
              imageUrl={imageUrl}
              uploading={fusionUploading?.product ?? uploading}
              disabled={uploadDisabled}
              error={fusionErrors?.product}
              onPreviewImage={onPreviewImage ? () => onPreviewImage('product') : undefined}
              onUpload={onImageUpload}
              onRemove={onRemoveImage ? () => onRemoveImage('product') : undefined}
            />
            {imageUrl && referenceImageUrl && onSwapImages ? (
              <Button
                className="workstation-fusion-swap"
                size="small"
                type="text"
                icon={<SwapOutlined />}
                aria-label="交换商品图与场景图"
                title="交换商品图与场景图"
                disabled={uploadDisabled || Boolean(fusionUploading?.product) || Boolean(fusionUploading?.reference)}
                onClick={onSwapImages}
              />
            ) : null}
            <FusionSlot
              label="场景图"
              hint="提供新背景的场景图，只作背景"
              imageUrl={referenceImageUrl}
              uploading={fusionUploading?.reference ?? uploading}
              disabled={uploadDisabled}
              error={fusionErrors?.reference}
              onPreviewImage={onPreviewImage ? () => onPreviewImage('reference') : undefined}
              onUpload={onReferenceImageUpload ?? onImageUpload}
              onRemove={onRemoveImage ? () => onRemoveImage('reference') : undefined}
              lastScene={lastScene}
              onReuseLastScene={onReuseLastScene}
              reusingLastScene={reusingLastScene}
            />
          </div>
        )}
        {errorLabel ? (
          <div className="workstation-canvas-state is-warning" role="alert">
            <span>{errorLabel}</span>
          </div>
        ) : processingLabel ? (
          <div className="workstation-canvas-state is-processing" role="status">
            <Spin size="small" />
            <span>{processingLabel}</span>
          </div>
        ) : null}
        {viewingResult && footnote !== null ? (
          <div className="workstation-canvas-footnote">正在查看融合结果；切回「输入」可替换商品图或场景图。</div>
        ) : null}
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div className={`${canvasShellClass} is-empty${emptyExtra ? ' has-empty-extra' : ''}`}>
        {emptyExtra ? <div className="workstation-empty-extra">{emptyExtra}</div> : null}
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
    const comparingResult = compareAvailable && compareMode === 'effect' && Boolean(resultImageUrl)
    return (
      <div className={`${canvasShellClass} is-mask-paint`}>
        <div className="workstation-canvas-controls">
          <div className="workstation-canvas-toolbar">
            <BrushToolbar
              brushSize={brushSize}
              tool={paintTool}
              smartSelectEnabled={smartSelectEnabled}
              smartSelectReady={smartSelectReady}
              smartSelectError={Boolean(capabilityError)}
              refineMode={refineMode}
              disabled={paintDisabled || comparingResult}
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
          <div className="workstation-canvas-actions">
            {compareAvailable ? (
              <Segmented
                size="small"
                aria-label="对比原图与效果"
                value={compareMode}
                options={[{ label: '原图', value: 'original' }, { label: '效果', value: 'effect' }]}
                onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
              />
            ) : null}
            {!refineMode && <div className="workstation-canvas-replace">{replaceButton}</div>}
          </div>
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>正在加载蒙版画布…</div>}>
          <MaskPaintCanvas
            ref={setMaskHandle}
            imageUrl={imageUrl}
            previewImageUrl={resultImageUrl}
            comparing={comparingResult}
            imageObjectKey={imageObjectKey}
            imageNaturalSize={imageNaturalSize}
            brushSize={brushSize}
            tool={paintTool}
            smartSelectEnabled={smartSelectEnabled}
            refineMode={refineMode}
            disabled={paintDisabled}
            onHistoryChange={setHistoryState}
            onMaskChange={onMaskChange}
            onToolChange={selectPaintTool}
            onBrushSizeChange={setBrushSize}
          />
        </Suspense>
        {comparingResult ? (
          <div className="workstation-canvas-footnote">正在查看生成效果；切回「原图」可继续涂抹。</div>
        ) : smartSelectEnabled ? (
          <div className="workstation-canvas-footnote">点击主体自动选取轮廓；文字、水印或细节建议使用画笔涂抹。</div>
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

  const viewingOriginal = compareMode === 'original' || !compareAvailable
  const defaultFootnote = interactionMode === 'params-only'
    ? compareAvailable
      ? '选择满意的结果后，可继续进行二次编辑'
      : '调整右侧参数后生成，结果会显示在这里'
    : '该功能即将上线，敬请期待'

  return (
    <div className={canvasShellClass}>
      <div className="workstation-canvas-controls">
        <div className="workstation-canvas-toolbar">
          {compareAvailable ? (
            <Segmented
              value={compareMode}
              options={[{ label: '原图', value: 'original' }, { label: '效果', value: 'effect' }]}
              onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
            />
          ) : null}
          {overlayToggle ? (
            <>
              <button
                type="button"
                className="workstation-overlay-toggle"
                aria-pressed={overlayToggle.pressed}
                title="实线箭头 = 主光；镜头/辉光徽标 = 正面/逆光；虚线 = 投影"
                onClick={overlayToggle.onChange}
              >
                <BulbOutlined aria-hidden="true" />
                {overlayToggle.label}
              </button>
              {overlayHint ? <span className="workstation-overlay-hint">{overlayHint}</span> : null}
            </>
          ) : null}
        </div>
        <div className="workstation-canvas-replace">{replaceButton}</div>
      </div>
      <div className="workstation-preview-stage">
        <img
          src={viewingOriginal ? originalImageUrl ?? imageUrl : imageUrl}
          alt={viewingOriginal ? '原始图片' : '当前编辑效果'}
          className={`workstation-preview-image${onPreview ? ' is-previewable' : ''}`}
          tabIndex={onPreview ? 0 : undefined}
          role={onPreview ? 'button' : undefined}
          aria-label={onPreview ? `打开${viewingOriginal ? '原图' : '效果'}大图` : undefined}
          onClick={onPreview ? () => onPreview(viewingOriginal ? 'original' : 'effect') : undefined}
          onKeyDown={onPreview ? event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            onPreview(viewingOriginal ? 'original' : 'effect')
          } : undefined}
        />
        {overlay}
      </div>
      {errorLabel ? (
        <div className="workstation-canvas-state is-warning" role="alert">
          <span>{errorLabel}</span>
        </div>
      ) : processingLabel ? (
        <div className="workstation-canvas-state is-processing" role="status">
          <Spin size="small" />
          <span>{processingLabel}</span>
        </div>
      ) : null}
      {errorLabel || processingLabel || footnote === null ? null : (
        <div className="workstation-canvas-footnote">{footnote ?? defaultFootnote}</div>
      )}
    </div>
  )
}
