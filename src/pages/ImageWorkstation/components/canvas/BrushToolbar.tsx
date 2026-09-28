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

export type PaintTool = 'brush' | 'eraser'

interface Props {
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  smartSelectReady: boolean
  refineMode?: boolean
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
  refineMode = false,
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
  return (
    <Space
      size={6}
      wrap
      style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface)', boxShadow: '0 4px 16px #0006' }}
    >
      <Tooltip title="画笔">
        <Button
          aria-label="画笔"
          type={tool === 'brush' && !smartSelectEnabled ? 'primary' : 'text'}
          icon={<EditOutlined />}
          onClick={() => onToolChange('brush')}
        />
      </Tooltip>
      <Tooltip title="橡皮擦">
        <Button
          aria-label="橡皮擦"
          type={tool === 'eraser' && !smartSelectEnabled ? 'primary' : 'text'}
          icon={<DeleteOutlined />}
          onClick={() => onToolChange('eraser')}
        />
      </Tooltip>
      <Tooltip title={refineMode ? '边缘精修请用画笔' : smartSelectReady ? '点击商品以选中轮廓' : '智能选区即将上线'}>
        <span>
          <Button
            aria-label="智能选区"
            type={smartSelectEnabled ? 'primary' : 'text'}
            icon={<AimOutlined />}
            disabled={refineMode || !smartSelectReady}
            onClick={onSmartSelectToggle}
          />
        </span>
      </Tooltip>
      <Tooltip title={refineMode ? '边缘精修请用画笔' : '反选商品以外的区域'}>
        <span>
          <Button
            aria-label="反选"
            type="text"
            icon={<SwapOutlined />}
            disabled={refineMode}
            onClick={onInvert}
          />
        </span>
      </Tooltip>
      <span style={{ width: 84, padding: '0 8px' }}>
        <Slider
          aria-label="笔刷大小"
          min={4}
          max={80}
          value={brushSize}
          onChange={onBrushSizeChange}
          tooltip={{ formatter: (value) => `${value}px` }}
        />
      </span>
      <Tooltip title="撤销">
        <Button aria-label="撤销" type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} />
      </Tooltip>
      <Tooltip title="重做">
        <Button aria-label="重做" type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} />
      </Tooltip>
      <Tooltip title="清空蒙版">
        <Button aria-label="清空蒙版" type="text" danger icon={<ClearOutlined />} onClick={onClear} />
      </Tooltip>
    </Space>
  )
}
