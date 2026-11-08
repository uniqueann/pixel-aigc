import { DownloadOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { AssetId, ImageAsset } from '@/editor/types'

interface ImageAssetStripProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  /** next-input：选中结果作为下一轮输入；inpaint-result：本次结果。裂变结果改用网格组件。 */
  variant?: 'next-input' | 'inpaint-result'
  downloadingAssetId?: AssetId
  onSelect: (assetId: AssetId) => void
  onDownload?: (asset: ImageAsset, index: number) => void
  onPreview: (assetId: AssetId) => void
}

/** 生成结果候选条；选中项的含义由 variant 决定。 */
export default function ImageAssetStrip({
  assets,
  selectedAssetId,
  variant = 'next-input',
  downloadingAssetId,
  onSelect,
  onDownload,
  onPreview,
}: ImageAssetStripProps) {
  if (assets.length === 0) return null
  const selectedIndex = assets.findIndex(asset => asset.id === selectedAssetId)
  const inpaintResult = variant === 'inpaint-result'
  const hint = selectedIndex >= 0
    ? inpaintResult
      ? `第 ${selectedIndex + 1} 张已作为当前原图，可继续编辑`
      : `第 ${selectedIndex + 1} 张将作为下一轮输入`
    : inpaintResult
      ? '点击缩略图可基于该结果继续编辑，或直接下载'
      : '选中一张作为下一轮输入'
  const badge = inpaintResult ? '当前原图' : '下一轮输入'
  const resultLabel = inpaintResult ? '结果' : '候选结果'
  const stripLabel = inpaintResult ? '本次结果' : '候选结果'
  const selectedSuffix = inpaintResult ? '，当前作为原图' : '，当前作为下一轮输入'

  return (
    <div className="workstation-result-strip" aria-label={stripLabel}>
      <div className="workstation-result-strip-head">
        <span className="workstation-result-strip-title">{stripLabel}</span>
        <span className="workstation-result-strip-hint">{hint}</span>
      </div>
      <div className="workstation-result-list" role="list">
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
