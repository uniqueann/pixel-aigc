import { DownloadOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { AssetId, ImageAsset } from '@/editor/types'

interface ImageAssetStripProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  downloadingAssetId?: AssetId
  onSelect: (assetId: AssetId) => void
  onDownload?: (asset: ImageAsset, index: number) => void
  onPreview: (assetId: AssetId) => void
}

/** 智能编辑生成结果候选条，选中的结果会成为下一次编辑输入。 */
export default function ImageAssetStrip({
  assets,
  selectedAssetId,
  downloadingAssetId,
  onSelect,
  onDownload,
  onPreview,
}: ImageAssetStripProps) {
  if (assets.length === 0) return null
  const selectedIndex = assets.findIndex(asset => asset.id === selectedAssetId)

  return (
    <div className="workstation-result-strip" aria-label="候选结果">
      <div className="workstation-result-strip-head">
        <span className="workstation-result-strip-title">候选结果</span>
        <span className="workstation-result-strip-hint">
          {selectedIndex >= 0
            ? `第 ${selectedIndex + 1} 张将作为下一轮输入`
            : '选中一张作为下一轮输入'}
        </span>
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
                aria-label={`选择候选结果 ${index + 1}${selected ? '，当前作为下一轮输入' : ''}`}
                aria-pressed={selected}
                onClick={() => onSelect(asset.id)}
              >
                <img src={asset.url} alt={`候选结果 ${index + 1}`} />
                <span className="workstation-result-index" aria-hidden="true">{index + 1}</span>
                {selected ? <span className="workstation-result-badge">下一轮输入</span> : null}
              </button>
              <div className="workstation-result-actions">
                <Button
                  className="preview-zoom-button"
                  size="small"
                  type="text"
                  icon={<ZoomInOutlined />}
                  aria-label={`放大候选结果 ${index + 1}`}
                  onClick={() => onPreview(asset.id)}
                />
                {onDownload ? (
                  <Button
                    className="workstation-result-download"
                    size="small"
                    type="text"
                    icon={<DownloadOutlined />}
                    aria-label={`下载候选结果 ${index + 1}`}
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
