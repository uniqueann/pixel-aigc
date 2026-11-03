import { Segmented } from 'antd'
import type { PreviewItem } from '@/components/PreviewGallery'
import { resultStatusLabel, type ResultStatus } from './resultStatus'

export type ResultFilter = 'all' | 'succeeded' | 'failed'

export interface ResultGridItem {
  id: string
  name: string
  sourceUrl: string
  status: ResultStatus
}

interface Props {
  items: ResultGridItem[]
  results: Map<string, PreviewItem>
  selectedId: string | null
  filter: ResultFilter
  onFilterChange: (filter: ResultFilter) => void
  onSelect: (id: string) => void
  /** 网格的无障碍名称，例如“水印结果网格”。 */
  ariaLabel: string
  /** 透明结果需要棋盘格，否则透明区域会露出背后的页面。 */
  checkerboard?: boolean
  /** 少量结果时不撑满固定高度，避免预览区留下大片空白。 */
  compact?: boolean
  emptyLabel?: string
}

export default function ResultGrid({
  items,
  results,
  selectedId,
  filter,
  onFilterChange,
  onSelect,
  ariaLabel,
  checkerboard = false,
  compact = false,
  emptyLabel = '没有符合筛选的结果',
}: Props) {
  const completed = items.filter(item => item.status === 'succeeded').length
  const failed = items.filter(item => item.status === 'failed').length
  const visible = items.filter(item => {
    if (filter === 'succeeded') return item.status === 'succeeded'
    if (filter === 'failed') return item.status === 'failed'
    return true
  })

  return (
    <div className={`toolbox-result-grid${compact ? ' is-compact' : ''}`} role="group" aria-label={ariaLabel}>
      <div className="toolbox-result-grid-toolbar">
        <Segmented
          size="small"
          aria-label="筛选结果"
          value={filter}
          options={[
            { label: '全部', value: 'all' },
            { label: `成功 ${completed}`, value: 'succeeded' },
            { label: `失败 ${failed}`, value: 'failed' },
          ]}
          onChange={value => onFilterChange(value === 'succeeded' || value === 'failed' ? value : 'all')}
        />
      </div>
      {visible.length === 0 ? (
        <p className="toolbox-result-grid-empty">{emptyLabel}</p>
      ) : (
        <div className="toolbox-result-grid-items">
          {visible.map(item => {
            const result = results.get(item.id)
            return (
              <button
                key={item.id}
                type="button"
                className={`toolbox-result-tile${item.id === selectedId ? ' is-selected' : ''}`}
                aria-pressed={item.id === selectedId}
                aria-label={`${item.name}，${resultStatusLabel(item.status)}${result ? '，查看结果' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <span className={`toolbox-result-thumb${result && checkerboard ? ' is-transparent' : ''}`}>
                  <img src={result?.fullSrc ?? item.sourceUrl} alt="" />
                  <span className={`toolbox-result-badge is-${item.status}`}>{resultStatusLabel(item.status)}</span>
                </span>
                <span className="toolbox-result-name">{item.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
