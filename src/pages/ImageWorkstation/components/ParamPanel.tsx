import { Select, Slider, Space } from 'antd'
import { Capability } from '@/types'

interface Props {
  capability: Capability
}

/**
 * 右侧参数面板：按 capability 渲染不同表单。
 * 这里先实现「智能编辑」和「重新打光」两个示例，其余工具照此模式补充。
 */
export default function ParamPanel({ capability }: Props) {
  if (capability === Capability.Relight) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>模式</div>
          <Select
            style={{ width: '100%' }}
            defaultValue="soft"
            options={[
              { value: 'hard', label: '强光' },
              { value: 'soft', label: '柔光' },
              { value: 'manual', label: '手动调整' },
            ]}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>后期增强</div>
          <Select
            style={{ width: '100%' }}
            defaultValue="medium"
            options={[
              { value: 'high', label: '高' },
              { value: 'medium', label: '中' },
              { value: 'low', label: '低' },
              { value: 'off', label: '关闭' },
            ]}
          />
        </div>
      </Space>
    )
  }

  // 默认：智能编辑一类的通用参数
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>模型</div>
        <Select style={{ width: '100%' }} defaultValue="default" options={[{ value: 'default', label: '默认模型' }]} />
      </div>
      <div>
        <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>生成尺寸</div>
        <Select style={{ width: '100%' }} placeholder="选择平台预设" options={[]} />
      </div>
      <div>
        <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>生成数量</div>
        <Slider min={1} max={4} step={1} marks={{ 1: '1', 2: '2', 3: '3', 4: '4' }} />
      </div>
      <div>
        <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>渲染分辨率</div>
        <Select
          style={{ width: '100%' }}
          defaultValue="2k"
          options={[
            { value: '2k', label: '2K' },
            { value: '4k', label: '4K' },
          ]}
        />
      </div>
    </Space>
  )
}
