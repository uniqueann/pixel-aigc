import { Button, Slider, Space, Tooltip } from 'antd'
import {
  AimOutlined,
  ClearOutlined,
  DeleteOutlined,
  EditOutlined,
  RedoOutlined,
  SwapOutlined,
  UndoOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

export type PaintTool = 'brush' | 'eraser'

interface Props {
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  smartSelectReady: boolean | undefined
  smartSelectError?: boolean
  refineMode?: boolean
  disabled?: boolean
  canUndo: boolean
  canRedo: boolean
  onBrushSizeChange: (size: number) => void
  onToolChange: (tool: PaintTool) => void
  onSmartSelectToggle: () => void
  onInvert: () => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
}

export default function BrushToolbar({
  brushSize,
  tool,
  smartSelectEnabled,
  smartSelectReady,
  smartSelectError = false,
  refineMode = false,
  disabled = false,
  canUndo,
  canRedo,
  onBrushSizeChange,
  onToolChange,
  onSmartSelectToggle,
  onInvert,
  onUndo,
  onRedo,
  onClear,
}: Props) {
  const { t } = useTranslation(['workstation', 'toolbox', 'common'])
  const smartSelectTooltip = refineMode
    ? t('brush.refineUsePen')
    : smartSelectReady
      ? t('brush.smartSelectReadyHint')
      : smartSelectReady === false
        ? t('brush.smartSelectComingSoon')
        : smartSelectError
          ? t('brush.smartSelectLoadFailed')
          : t('brush.smartSelectLoading')

  return (
    <Space
      size={4}
      wrap
      style={{
        padding: '4px 8px',
        borderRadius: 8,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
      }}
    >
      <Tooltip title={t('brush.pen')}>
        <Button
          size="small"
          aria-label={t('brush.pen')}
          aria-pressed={tool === 'brush' && !smartSelectEnabled}
          type={tool === 'brush' && !smartSelectEnabled ? 'primary' : 'text'}
          icon={<EditOutlined />}
          disabled={disabled}
          onClick={() => onToolChange('brush')}
        />
      </Tooltip>
      <Tooltip title={t('brush.eraser')}>
        <Button
          size="small"
          aria-label={t('brush.eraser')}
          aria-pressed={tool === 'eraser' && !smartSelectEnabled}
          type={tool === 'eraser' && !smartSelectEnabled ? 'primary' : 'text'}
          icon={<DeleteOutlined />}
          disabled={disabled}
          onClick={() => onToolChange('eraser')}
        />
      </Tooltip>
      <Tooltip title={smartSelectTooltip}>
        <span>
          <Button
            size="small"
            aria-label={t('toolbox:aspectRatio.smartSelect')}
            aria-pressed={smartSelectEnabled}
            type={smartSelectEnabled ? 'primary' : 'text'}
            icon={<AimOutlined />}
            disabled={disabled || refineMode || !smartSelectReady}
            onClick={onSmartSelectToggle}
          />
        </span>
      </Tooltip>
      <Tooltip title={refineMode ? t('brush.refineUsePen') : t('brush.invertHint')}>
        <span>
          <Button
            size="small"
            aria-label={t('brush.invert')}
            type="text"
            icon={<SwapOutlined />}
            disabled={disabled || refineMode}
            onClick={onInvert}
          />
        </span>
      </Tooltip>
      {/* 触控下 Slider 的 tooltip 只在拖动时出现，常驻数值让当前笔刷大小始终可见。 */}
      <span className="workstation-brush-size">
        <span className="workstation-brush-size-slider">
          <Slider
            ariaLabelForHandle={t('brush.size')}
            ariaValueTextFormatterForHandle={(value) => t('brush.sizePixels', { value })}
            min={4}
            max={80}
            value={brushSize}
            disabled={disabled}
            onChange={onBrushSizeChange}
            tooltip={{ formatter: (value) => `${value}px` }}
          />
        </span>
        <span className="workstation-brush-size-value" aria-hidden="true">{brushSize}px</span>
      </span>
      <Tooltip title={t('common:actions.undo')}>
        <Button size="small" aria-label={t('common:actions.undo')} type="text" icon={<UndoOutlined />} disabled={disabled || !canUndo} onClick={onUndo} />
      </Tooltip>
      <Tooltip title={t('brush.redo')}>
        <Button size="small" aria-label={t('brush.redo')} type="text" icon={<RedoOutlined />} disabled={disabled || !canRedo} onClick={onRedo} />
      </Tooltip>
      <Tooltip title={t('brush.clearMask')}>
        <Button size="small" aria-label={t('brush.clearMask')} type="text" danger icon={<ClearOutlined />} disabled={disabled} onClick={onClear} />
      </Tooltip>
    </Space>
  )
}
