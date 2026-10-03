import type { ReactNode } from 'react'
import { ColorPicker, Radio } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import type { AspectRatioSettings, FitStrategy } from '../aspect-ratio/types'

const focuses = [
  { fx: 0, fy: 0, label: '左上' },
  { fx: 0.5, fy: 0, label: '上中' },
  { fx: 1, fy: 0, label: '右上' },
  { fx: 0, fy: 0.5, label: '左中' },
  { fx: 0.5, fy: 0.5, label: '正中' },
  { fx: 1, fy: 0.5, label: '右中' },
  { fx: 0, fy: 1, label: '左下' },
  { fx: 0.5, fy: 1, label: '下中' },
  { fx: 1, fy: 1, label: '右下' },
]

const strategies: { label: string; value: FitStrategy }[] = [
  { label: '留白填充', value: 'letterbox' },
  { label: '智能裁剪', value: 'crop' },
  { label: '智能扩展', value: 'outpaint' },
]
const allStrategies: FitStrategy[] = ['letterbox', 'crop', 'outpaint']
interface Props {
  settings: AspectRatioSettings
  disabled: boolean
  onChange: (patch: Partial<AspectRatioSettings>) => void
  allowedStrategies?: readonly FitStrategy[]
  outpaintStatus?: ReactNode
  templates?: ReactNode
}

export default function AspectRatioSettingsPanel({ settings, disabled, onChange, allowedStrategies = allStrategies, outpaintStatus, templates }: Props) {
  const preset = PLATFORM_SIZE_PRESETS.find(item => item.id === settings.selectedPresetId) ?? PLATFORM_SIZE_PRESETS[0]
  return (
    <section className="toolbox-settings-panel" aria-label="转比例设置">
      <div className="toolbox-section-heading"><div><strong>转比例设置</strong><span>一次设置，应用到整批</span></div></div>
      <label className="toolbox-field-label">目标平台</label>
      <Radio.Group
        value={preset.id}
        disabled={disabled}
        onChange={event => onChange({ selectedPresetId: event.target.value })}
      >
        {PLATFORM_SIZE_PRESETS.map(item => (
          <Radio key={item.id} value={item.id} style={{ display: 'flex', marginBottom: 6 }}>
            {item.label} {item.width} × {item.height}
          </Radio>
        ))}
      </Radio.Group>
      <label className="toolbox-field-label">适配策略</label>
      <Radio.Group
        value={settings.strategy}
        disabled={disabled}
        onChange={event => onChange({ strategy: event.target.value })}
        options={strategies.filter(option => allowedStrategies.includes(option.value))}
      />
      {settings.strategy === 'letterbox' && <p className="toolbox-hint">留白会把原图完整放进目标尺寸，空白处用所选颜色填上。</p>}
      {settings.strategy === 'outpaint' && (
        <>
          <label className="toolbox-field-label">输出模式</label>
          <Radio.Group
            value={settings.outpaintOutputMode ?? 'platform'}
            disabled={disabled}
            onChange={event => onChange({ outpaintOutputMode: event.target.value })}
            options={[
              { label: '按平台尺寸输出', value: 'platform' },
              { label: '保留原图分辨率', value: 'original' },
            ]}
          />
          <p className="toolbox-hint">
            {settings.outpaintOutputMode === 'original'
              ? '原图保持原尺寸，按平台比例补背景；每张图片的输出尺寸随原图变化，比例一致时保留原文件。'
              : `输出精确的 ${preset.width} × ${preset.height} 平台尺寸，原图会按尺寸缩放。`}
            预览里的深色区域是待补全的留白。
          </p>
        </>
      )}
      {settings.strategy === 'outpaint' && outpaintStatus}
      {settings.strategy === 'letterbox' && (
        <>
          <div className="toolbox-field-row">
            <span>留白颜色</span>
            <ColorPicker value={settings.background === 'transparent' ? '#ffffff' : settings.background} disabled={disabled || settings.background === 'transparent'} onChange={color => onChange({ background: color.toHexString() })} />
          </div>
          <Radio.Group
            value={settings.background === 'transparent' ? 'transparent' : 'color'}
            disabled={disabled}
            onChange={event => onChange({ background: event.target.value === 'transparent' ? 'transparent' : '#ffffff' })}
            options={[{ label: '纯色', value: 'color' }, { label: '透明 PNG', value: 'transparent' }]}
            optionType="button"
          />
        </>
      )}
      {settings.strategy === 'crop' && (
        <>
          <label className="toolbox-field-label">裁剪焦点</label>
          <div className="toolbox-anchor-grid">
            {focuses.map(focus => (
              <button
                key={focus.label}
                type="button"
                className={settings.fx === focus.fx && settings.fy === focus.fy ? 'is-active' : ''}
                disabled={disabled}
                onClick={() => onChange({ fx: focus.fx, fy: focus.fy })}
              >
                {focus.label}
              </button>
            ))}
          </div>
          <p className="toolbox-hint">处理时识别商品主体并按主体裁剪。识别不到或检测失败时，按当前九宫格裁完，这一张仍算成功。队列里出现黄色提示时，先把焦点改到商品所在位置，再重新处理。</p>
        </>
      )}
      {templates}
    </section>
  )
}
