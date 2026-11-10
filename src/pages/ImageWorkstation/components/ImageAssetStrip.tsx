import { DownloadOutlined, EditOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { AssetId, ImageAsset } from '@/editor/types'

interface ImageAssetStripProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  /**
   * next-input：选中结果作为下一轮输入；
   * inpaint-result：本次结果作为原图；
   * outpaint-result：本次结果已在扩图画布中显示，可继续扩图；
   * result：本次结果在主舞台预览。裂变结果改用网格组件。
   */
  variant?: 'next-input' | 'inpaint-result' | 'outpaint-result' | 'result'
  /** grid：多结果并排对比，卡片放大；默认横向候选条。 */
  layout?: 'strip' | 'grid'
  downloadingAssetId?: AssetId
  downloadingAll?: boolean
  onSelect: (assetId: AssetId) => void
  onDownload?: (asset: ImageAsset, index: number) => void
  onPreview: (assetId: AssetId) => void
  onDownloadAll?: () => void
  /** 在选中结果上继续编辑；仅精修传入，且选中结果不是当前输入时才显示。 */
  onContinue?: (asset: ImageAsset) => void
  continueLabel?: string
  continueDisabled?: boolean
}

/** 生成结果候选条；选中项的含义由 variant 决定。 */
export default function ImageAssetStrip({
  assets,
  selectedAssetId,
  variant = 'next-input',
  layout = 'strip',
  downloadingAssetId,
  downloadingAll = false,
  onSelect,
  onDownload,
  onPreview,
  onDownloadAll,
  onContinue,
  continueLabel = '继续编辑',
  continueDisabled = false,
}: ImageAssetStripProps) {
  if (assets.length === 0) return null
  const selectedIndex = assets.findIndex(asset => asset.id === selectedAssetId)
  const inpaintResult = variant === 'inpaint-result'
  const outpaintResult = variant === 'outpaint-result'
  const plainResult = variant === 'result'
  const grid = layout === 'grid'
  const hint = selectedIndex >= 0
    ? inpaintResult
      ? `第 ${selectedIndex + 1} 张已作为当前原图，可继续编辑`
      : outpaintResult
        ? `第 ${selectedIndex + 1} 张已在画布显示，可继续扩图`
        : plainResult
          ? `第 ${selectedIndex + 1} 张已在预览区显示`
          : `第 ${selectedIndex + 1} 张将作为下一轮输入`
    : inpaintResult
      ? '点击缩略图可基于该结果继续编辑，或直接下载'
      : outpaintResult
        ? '点击缩略图切换画布中的结果，或直接下载'
        : plainResult
          ? grid ? '并排查看多张结果，点击图片在预览区查看' : '点击缩略图在预览区查看，或直接下载'
          : '选中一张作为下一轮输入'
  const badge = inpaintResult ? '当前原图' : outpaintResult ? '画布中' : plainResult ? '预览中' : '下一轮输入'
  const resultLabel = inpaintResult || outpaintResult || plainResult ? '结果' : '候选结果'
  const stripLabel = inpaintResult || outpaintResult || plainResult ? '本次结果' : '候选结果'
  const selectedSuffix = inpaintResult
    ? '，当前作为原图'
    : outpaintResult
      ? '，已在画布显示'
      : plainResult
        ? '，已在预览区显示'
        : '，当前作为下一轮输入'

  return (
    <div className="workstation-result-strip" role="group" aria-label={stripLabel}>
      <div className={`workstation-result-strip-head${grid ? ' is-grid' : ''}`}>
        <span className="workstation-result-strip-title">{stripLabel}</span>
        {grid ? <span className="workstation-result-count">{assets.length} 张</span> : null}
        <span className="workstation-result-strip-hint">{hint}</span>
        {(onContinue && selectedIndex >= 0) || (grid && assets.length > 1 && onDownloadAll) ? (
          <span className="workstation-result-strip-actions">
            {onContinue && selectedIndex >= 0 ? (
              <Button
                className="workstation-result-continue"
                size="small"
                icon={<EditOutlined aria-hidden="true" />}
                disabled={continueDisabled}
                onClick={() => onContinue(assets[selectedIndex])}
              >
                {continueLabel}
              </Button>
            ) : null}
            {grid && assets.length > 1 && onDownloadAll ? (
              <Button
                className="workstation-result-download-all"
                size="small"
                icon={<DownloadOutlined aria-hidden="true" />}
                loading={downloadingAll}
                onClick={onDownloadAll}
              >
                下载全部
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className={`workstation-result-list${grid ? ' is-grid' : ''}`} role="list">
        {assets.map((asset, index) => {
          const selected = asset.id === selectedAssetId
          return (
            <div
              key={asset.id}
              role="listitem"
              className={`workstation-result-item${selected ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                className="workstation-result-thumb"
                aria-label={`选择${resultLabel} ${index + 1}${selected ? selectedSuffix : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(asset.id)}
              >
                <img src={asset.url} alt={`${resultLabel} ${index + 1}`} />
                <span className="workstation-result-index" aria-hidden="true">{index + 1}</span>
                {selected ? <span className="workstation-result-badge">{badge}</span> : null}
              </button>
              <div className="workstation-result-actions">
                <Button
                  className="preview-zoom-button"
                  size="small"
                  type="text"
                  icon={<ZoomInOutlined />}
                  aria-label={`放大${resultLabel} ${index + 1}`}
                  onClick={() => onPreview(asset.id)}
                />
                {onDownload ? (
                  <Button
                    className="workstation-result-download"
                    size="small"
                    type="text"
                    icon={<DownloadOutlined />}
                    aria-label={`下载${resultLabel} ${index + 1}`}
                    loading={downloadingAssetId === asset.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDownload(asset, index)
                    }}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
