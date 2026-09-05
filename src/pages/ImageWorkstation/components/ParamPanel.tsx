import { Input, Segmented, Select, Slider, Space } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { Capability } from '@/types'

interface Props {
  capability: Capability
  mode?: 'remove' | 'repaint'
  repaintPrompt: string
  onRepaintPromptChange: (prompt: string) => void
  outpaintMode: 'free' | 'preset'
  onOutpaintModeChange: (mode: 'free' | 'preset') => void
  presetPlatform: string
  onPresetPlatformChange: (platform: string) => void
}

const labelStyle = { marginBottom: 6, fontSize: 12, color: 'var(--color-text-secondary)' }

/** 右侧参数面板：按能力和子工具模式渲染对应表单 */
export default function ParamPanel({
  capability,
  mode,
  repaintPrompt,
  onRepaintPromptChange,
  outpaintMode,
  onOutpaintModeChange,
  presetPlatform,
  onPresetPlatformChange,
}: Props) {
  if (capability === Capability.Relight) {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <div style={labelStyle}>模式</div>
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
          <div style={labelStyle}>后期增强</div>
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

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {mode === 'repaint' ? (
        <div>
          <div style={labelStyle}>重绘描述</div>
          <Input.TextArea
            value={repaintPrompt}
            onChange={(event) => onRepaintPromptChange(event.target.value)}
            placeholder="描述希望在选区内生成的内容"
            autoSize={{ minRows: 4, maxRows: 8 }}
          />
        </div>
      ) : null}

      {capability === Capability.Outpaint ? (
        <>
          <div>
            <div style={labelStyle}>扩图方式</div>
            <Segmented
              block
              options={[
                { label: '自由拖拽', value: 'free' },
                { label: '平台预设', value: 'preset' },
              ]}
              value={outpaintMode}
              onChange={(value) => onOutpaintModeChange(value as 'free' | 'preset')}
            />
          </div>
          {outpaintMode === 'preset' ? (
            <div>
              <div style={labelStyle}>目标平台</div>
              <Select
                style={{ width: '100%' }}
                value={presetPlatform}
                onChange={onPresetPlatformChange}
                options={PLATFORM_SIZE_PRESETS.map((preset) => ({
                  value: preset.platform,
                  label: `${preset.label} · ${preset.width}×${preset.height}`,
                }))}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div>
          <div style={labelStyle}>生成尺寸</div>
          <Select style={{ width: '100%' }} placeholder="选择平台预设" options={[]} />
        </div>
      )}

      <div>
        <div style={labelStyle}>模型</div>
        <Select style={{ width: '100%' }} defaultValue="default" options={[{ value: 'default', label: '默认模型' }]} />
      </div>
      <div>
        <div style={labelStyle}>生成数量</div>
        <Slider min={1} max={4} step={1} marks={{ 1: '1', 2: '2', 3: '3', 4: '4' }} />
      </div>
      <div>
        <div style={labelStyle}>渲染分辨率</div>
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
