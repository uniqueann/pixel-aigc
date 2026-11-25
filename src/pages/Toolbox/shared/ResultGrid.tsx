import { useTranslation } from 'react-i18next'
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
  emptyLabel,
}: Props) {
  const { t } = useTranslation('toolbox')
  const resolvedEmptyLabel = emptyLabel ?? t('resultGrid.empty')
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
          aria-label={t('resultGrid.filterAria')}
          value={filter}
          options={[
            { label: t('resultGrid.filterAll'), value: 'all' },
            { label: t('resultGrid.filterSucceeded', { count: completed }), value: 'succeeded' },
            { label: t('resultGrid.filterFailed', { count: failed }), value: 'failed' },
          ]}
          onChange={value => onFilterChange(value === 'succeeded' || value === 'failed' ? value : 'all')}
        />
      </div>
      {visible.length === 0 ? (
        <p className="toolbox-result-grid-empty">{resolvedEmptyLabel}</p>
      ) : (
        <div className="toolbox-result-grid-items">
          {visible.map(item => {
            const result = results.get(item.id)
            const statusText = resultStatusLabel(item.status)
            return (
              <button
                key={item.id}
                type="button"
                className={`toolbox-result-tile${item.id === selectedId ? ' is-selected' : ''}`}
                aria-pressed={item.id === selectedId}
                aria-label={result ? t('resultGrid.tileAriaWithResult', { name: item.name, status: statusText }) : t('resultGrid.tileAria', { name: item.name, status: statusText })}
                onClick={() => onSelect(item.id)}
              >
                <span className={`toolbox-result-thumb${result && checkerboard ? ' is-transparent' : ''}`}>
                  <img src={result?.fullSrc ?? item.sourceUrl} alt="" />
                  <span className={`toolbox-result-badge is-${item.status}`}>{statusText}</span>
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
