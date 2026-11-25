import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Segmented, Spin, Upload, message } from 'antd'
import { BulbOutlined, HistoryOutlined, InboxOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { MAX_SCALE, type OutpaintOutputMode } from '@shared/outpaint'
import { formatMegabytes } from '@/i18n/format'
import { lazyWithRetry } from '@/utils/lazyWithRetry'
import { useCapabilities } from '@/hooks/useCapabilities'
import { imageFileError } from '@/services/api/upload'
import type { InteractionMode } from '../tools'
import BrushToolbar, { type PaintTool } from './canvas/BrushToolbar'
import CompareSlider from './CompareSlider'
import { compareAspectCompatible } from '../utils/compareSlider'
import type { MaskPaintCanvasHandle } from './canvas/MaskPaintCanvas'
import type { OutpaintCanvasHandle } from './canvas/OutpaintCanvas'
import { outpaintLimitReason } from '../utils/outpaintGeometry'

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
  /** 扩图：当前目标尺寸，用于画布读屏描述。 */
  outpaintTargetSize?: { width: number; height: number }
  /** 扩图：当前目标等于原图且没有缩放，提交会得到原图副本。 */
  outpaintIdle?: boolean
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
  /** 精修：用可拖动分割线同屏对比，替代原图/效果二选一。 */
  splitCompare?: boolean
  /** 精修结果的实际像素尺寸，用于 1:1 与宽高比兼容判断。 */
  resultNaturalSize?: { width: number; height: number }
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
  const { t } = useTranslation(['workstation', 'common'])
  const maxFileMb = formatMegabytes(20 * 1024 * 1024)
  const beforeUpload = (file: File) => {
    const invalid = imageFileError(file)
    if (invalid) {
      message.error(invalid)
      return Upload.LIST_IGNORE
    }
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
              title={t('canvas.fusion.viewLargeAria', { label })}
              aria-label={t('canvas.fusion.viewLargeAria', { label })}
              onClick={onPreviewImage}
            >
              <img src={imageUrl} alt={label} />
            </button>
          ) : <img src={imageUrl} alt={label} />}
          <div className="workstation-fusion-slot-actions">
            <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} disabled={uploading || disabled} beforeUpload={beforeUpload}>
              <Button size="small" icon={<UploadOutlined />} disabled={disabled} loading={uploading} aria-label={t('canvas.fusion.replaceAria', { label })}>{t('common:actions.replace')}</Button>
            </Upload>
            {onRemove ? (
              <Button size="small" type="text" danger disabled={disabled || uploading} aria-label={t('canvas.fusion.removeAria', { label })} onClick={onRemove}>{t('canvas.fusion.remove')}</Button>
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
            <p className="ant-upload-text">{uploading ? t('canvas.fusion.loadingSlot', { label }) : t('canvas.fusion.uploadSlot', { label })}</p>
            {uploading ? null : <p className="ant-upload-hint">{t('canvas.fusion.slotHintWithLimit', { hint, mb: maxFileMb })}</p>}
          </Upload.Dragger>
          {!uploading && lastScene && onReuseLastScene ? (
            <Button
              className="workstation-fusion-last-scene"
              size="small"
              type="link"
              icon={<HistoryOutlined />}
              loading={reusingLastScene}
              disabled={disabled}
              title={t('canvas.fusion.reuseLastSceneTitle', { name: lastScene.name })}
              aria-label={t('canvas.fusion.reuseLastSceneAria', { width: lastScene.width, height: lastScene.height })}
              onClick={onReuseLastScene}
            >
              {t('canvas.fusion.reuseLastScene')}
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
  outpaintTargetSize,
  outpaintIdle = false,
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
  overlay,
  emptyExtra,
  overlayToggle,
  overlayHint,
  compareAvailable = true,
  splitCompare = false,
  resultNaturalSize,
  footnote,
}: Props) {
  const { t } = useTranslation(['workstation', 'common'])
  const maxFileMb = formatMegabytes(20 * 1024 * 1024)
  const maskHandleRef = useRef<MaskPaintCanvasHandle | null>(null)
  const outpaintHandleRef = useRef<OutpaintCanvasHandle | null>(null)
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
      outpaintHandleRef.current = handle
      onReady(handle)
    },
    [onReady],
  )

  useEffect(() => {
    if (!imageUrl || (interactionMode !== 'mask-paint' && interactionMode !== 'drag-resize')) onReady(null)
    if (interactionMode !== 'mask-paint') onMaskChange?.(false)
  }, [imageUrl, interactionMode, onMaskChange, onReady])

  const interceptUpload = (file: File) => {
    // 选图时先做同步体积检查，不要等进入上传流程、看到转圈之后才报错。
    const invalid = imageFileError(file)
    if (invalid) {
      message.error(invalid)
      return Upload.LIST_IGNORE
    }
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
    // 两路输入都为空时才是「未开始」：示例放在槽位上方，与单图工具的空态示例同位置。
    const emptyBoth = !imageUrl && !referenceImageUrl && !viewingResult
    const showEmptyExtra = emptyBoth && Boolean(emptyExtra)
    return (
      <div className={`${canvasShellClass}${emptyBoth ? ' is-empty' : ''}${showEmptyExtra ? ' has-empty-extra' : ''}`}>
        {showEmptyExtra ? <div className="workstation-empty-extra">{emptyExtra}</div> : null}
        {compareAvailable ? (
          <div className="workstation-canvas-controls">
            <div className="workstation-canvas-toolbar">
              <Segmented
                aria-label={t('canvas.fusion.compareSwitchAria')}
                value={compareMode}
                options={[
                  { label: t('canvas.fusion.inputTab'), value: 'original' },
                  { label: t('canvas.compareEffectTab'), value: 'effect' },
                ]}
                onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
              />
            </div>
          </div>
        ) : null}
        {viewingResult ? (
          <div className="workstation-preview-stage">
            <img
              src={resultImageUrl}
              alt={t('canvas.fusion.resultAlt')}
              className={`workstation-preview-image${onPreview ? ' is-previewable' : ''}`}
              tabIndex={onPreview ? 0 : undefined}
              role={onPreview ? 'button' : undefined}
              aria-label={onPreview ? t('canvas.fusion.openResultLargeAria') : undefined}
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
              label={t('canvas.fusion.productLabel')}
              hint={t('canvas.fusion.productHint')}
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
                aria-label={t('canvas.fusion.swapAria')}
                title={t('canvas.fusion.swapAria')}
                disabled={uploadDisabled || Boolean(fusionUploading?.product) || Boolean(fusionUploading?.reference)}
                onClick={onSwapImages}
              />
            ) : null}
            <FusionSlot
              label={t('canvas.fusion.referenceLabel')}
              hint={t('canvas.fusion.referenceHint')}
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
        {processingLabel ? (
          <div className="workstation-canvas-state is-processing" role="status">
            <Spin size="small" />
            <span>{processingLabel}</span>
          </div>
        ) : null}
        {viewingResult && footnote !== null ? (
          <div className="workstation-canvas-footnote">{t('canvas.fusion.footnote')}</div>
        ) : null}
      </div>
    )
  }

  if (!imageUrl) {
    return (
      <div
        className={`${canvasShellClass} is-empty${emptyExtra ? ' has-empty-extra' : ''}${interactionMode === 'drag-resize' ? ' is-outpaint' : ''}`}
        aria-busy={uploading || undefined}
      >
        {emptyExtra ? <div className="workstation-empty-extra">{emptyExtra}</div> : null}
        <Upload.Dragger
          className="workstation-upload"
          accept="image/png,image/jpeg,image/webp"
          showUploadList={false}
          disabled={uploading || uploadDisabled}
          beforeUpload={interceptUpload}
        >
          <div className="ant-upload-drag-icon">{uploading ? <Spin /> : <InboxOutlined />}</div>
          <p className="ant-upload-text">{uploading ? t('canvas.upload.loading') : t('canvas.upload.prompt')}</p>
          {uploading ? null : uploadHint ? <p className="ant-upload-hint">{uploadHint}</p> : null}
          {uploading ? null : <p className="ant-upload-hint">{t('canvas.upload.formatLimit', { mb: maxFileMb })}</p>}
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
      <Button size="small" icon={<UploadOutlined />} loading={uploading}>{t('canvas.replaceImage')}</Button>
    </Upload>
  )

  const selectPaintTool = (tool: PaintTool) => {
    setPaintTool(tool)
    setSmartSelectEnabled(false)
  }

  if (interactionMode === 'mask-paint') {
    const comparingResult = compareAvailable && compareMode === 'effect' && Boolean(resultImageUrl)
    // 处理中：整块画布只留一条阶段提示，本地涂抹提示与脚注让位，避免同一底带叠三条消息。
    const paintStatus = processingLabel
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
                  message.error(error instanceof Error ? error.message : t('errors.invertFailed'))
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
                aria-label={t('canvas.compareOriginalEffectAria')}
                value={compareMode}
                options={[
                  { label: t('common:preview.originalShort'), value: 'original' },
                  { label: t('canvas.compareEffectTab'), value: 'effect' },
                ]}
                onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
              />
            ) : null}
            {!refineMode && <div className="workstation-canvas-replace">{replaceButton}</div>}
          </div>
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>{t('canvas.loadingMaskCanvas')}</div>}>
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
            hideDisabledHint={Boolean(paintStatus)}
            onHistoryChange={setHistoryState}
            onMaskChange={onMaskChange}
            onToolChange={selectPaintTool}
            onBrushSizeChange={setBrushSize}
          />
        </Suspense>
        {paintStatus ? (
          <div className="workstation-canvas-processing" role="status">
            <Spin size="small" />
            <span>{paintStatus}</span>
          </div>
        ) : null}
        {paintStatus ? null : comparingResult ? (
          <div className="workstation-canvas-footnote">{t('canvas.maskComparingFootnote')}</div>
        ) : smartSelectEnabled ? (
          <div className="workstation-canvas-footnote">{t('canvas.smartSelectFootnote')}</div>
        ) : null}
      </div>
    )
  }

  if (interactionMode === 'drag-resize') {
    const comparingOriginal = compareAvailable && compareMode === 'original' && Boolean(originalImageUrl)
    const limit = !presetTargetSize && !comparingOriginal && outpaintTargetSize
      ? outpaintLimitReason(imageNaturalSize.width, imageNaturalSize.height, outpaintTargetSize)
      : undefined
    return (
      <div className={`${canvasShellClass} is-outpaint`}>
        <div className="workstation-canvas-controls">
          <div className="workstation-canvas-hint">
            {comparingOriginal
              ? t('canvas.outpaint.comparingOriginal')
              : presetTargetSize
                ? t('canvas.outpaint.presetCentered')
                : outpaintIdle
                  ? compareAvailable
                    ? t('canvas.outpaint.idleAfterResult')
                    : t('canvas.outpaint.idleBeforeStart')
                  : t('canvas.outpaint.dragHint')}
            {limit ? (
              <span className="workstation-canvas-limit">
                {limit === 'size'
                  ? t('canvas.outpaint.limitSize', { maxScale: MAX_SCALE })
                  : t('canvas.outpaint.limitPixels')}
              </span>
            ) : null}
          </div>
          {compareAvailable ? (
            <Segmented
              size="small"
              aria-label={t('canvas.compareOriginalResultAria')}
              value={compareMode}
              options={[
                { label: t('common:preview.originalShort'), value: 'original' },
                { label: t('results.strip.itemResult'), value: 'effect' },
              ]}
              onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
            />
          ) : null}
          <div className="workstation-canvas-replace">
            {presetTargetSize || comparingOriginal ? null : (
              <Button
                size="small"
                title={t('canvas.outpaint.resetTitle')}
                onClick={() => outpaintHandleRef.current?.reset()}
              >
                {t('common:actions.reset')}
              </Button>
            )}
            {replaceButton}
          </div>
        </div>
        <Suspense fallback={<div style={{ color: 'var(--color-text-muted)' }}>{t('canvas.outpaint.loadingCanvas')}</div>}>
          <OutpaintCanvas
            ref={setOutpaintHandle}
            imageUrl={imageUrl}
            imageNaturalSize={imageNaturalSize}
            presetTargetSize={presetTargetSize}
            outputMode={outpaintOutputMode}
            targetSize={outpaintTargetSize}
            comparing={comparingOriginal}
            compareImageUrl={originalImageUrl}
            onTargetSizeChange={onOutpaintTargetSizeChange}
          />
        </Suspense>
        {comparingOriginal ? (
          <div className="workstation-canvas-footnote">{t('canvas.outpaint.comparingFootnote')}</div>
        ) : null}
      </div>
    )
  }

  // 精修：只有原图与结果宽高比接近时才同屏分割，否则退回原图/效果切换。
  const splitBeforeSrc = imageUrl ?? originalImageUrl
  const splitCompareReady = interactionMode === 'params-only'
    && splitCompare
    && compareAvailable
    && Boolean(resultImageUrl && splitBeforeSrc)
    && compareAspectCompatible(imageNaturalSize, resultNaturalSize)
  const viewingOriginal = compareMode === 'original' || !compareAvailable
  const defaultFootnote = splitCompareReady
    ? t('canvas.footnotes.splitCompare')
    : interactionMode === 'params-only'
      ? compareAvailable
        ? t('canvas.footnotes.selectToEdit')
        : t('canvas.footnotes.adjustAndGenerate')
      : t('toolsMeta.comingSoonSubmit')

  return (
    <div className={canvasShellClass}>
      <div className="workstation-canvas-controls">
        <div className="workstation-canvas-toolbar">
          {compareAvailable && !splitCompareReady ? (
            <Segmented
              aria-label={t('canvas.compareOriginalEffectAria')}
              value={compareMode}
              options={[
                { label: t('common:preview.originalShort'), value: 'original' },
                { label: t('canvas.compareEffectTab'), value: 'effect' },
              ]}
              onChange={(value) => onCompareModeChange(value as 'original' | 'effect')}
            />
          ) : null}
          {overlayToggle ? (
            <>
              <button
                type="button"
                className="workstation-overlay-toggle"
                aria-pressed={overlayToggle.pressed}
                title={t('relight.overlay.toggleTitle')}
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
        {splitCompareReady && splitBeforeSrc && resultImageUrl ? (
          <CompareSlider
            beforeSrc={splitBeforeSrc}
            afterSrc={resultImageUrl}
            beforeSize={imageNaturalSize}
            afterSize={resultNaturalSize}
          />
        ) : (
          <img
            src={viewingOriginal ? originalImageUrl ?? imageUrl : resultImageUrl ?? imageUrl}
            alt={viewingOriginal ? t('canvas.originalImageAlt') : t('compare.afterAlt')}
            className={`workstation-preview-image${onPreview ? ' is-previewable' : ''}`}
            tabIndex={onPreview ? 0 : undefined}
            role={onPreview ? 'button' : undefined}
            aria-label={onPreview ? t(viewingOriginal ? 'canvas.openOriginalLargeAria' : 'canvas.openEffectLargeAria') : undefined}
            onClick={onPreview ? () => onPreview(viewingOriginal ? 'original' : 'effect') : undefined}
            onKeyDown={onPreview ? event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onPreview(viewingOriginal ? 'original' : 'effect')
            } : undefined}
          />
        )}
        {overlay}
      </div>
      {processingLabel ? (
        <div className="workstation-canvas-state is-processing" role="status">
          <Spin size="small" />
          <span>{processingLabel}</span>
        </div>
      ) : null}
      {processingLabel || footnote === null ? null : (
        <div className="workstation-canvas-footnote">{footnote ?? defaultFootnote}</div>
      )}
    </div>
  )
}
