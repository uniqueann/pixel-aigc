import { useState, type ReactNode } from 'react'
import { Radio } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { FIT_STRATEGIES } from '../aspect-ratio/strategies'
import type { AspectRatioSettings, FitStrategy } from '../aspect-ratio/types'
import ColorDialog from './ColorDialog'

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

const allStrategies: FitStrategy[] = FIT_STRATEGIES.map(item => item.value)
interface Props {
  settings: AspectRatioSettings
  disabled: boolean
  onChange: (patch: Partial<AspectRatioSettings>) => void
  allowedStrategies?: readonly FitStrategy[]
  outpaintStatus?: ReactNode
  templates?: ReactNode
}

export default function AspectRatioSettingsPanel({ settings, disabled, onChange, allowedStrategies = allStrategies, outpaintStatus, templates }: Props) {
  const [colorDialogOpen, setColorDialogOpen] = useState(false)
  const preset = PLATFORM_SIZE_PRESETS.find(item => item.id === settings.selectedPresetId) ?? PLATFORM_SIZE_PRESETS[0]
  const background = settings.background === 'transparent' ? '#ffffff' : settings.background
  return (
    <section className="toolbox-settings-panel" aria-label="转比例设置">
      <div className="toolbox-section-heading"><div><strong>转比例设置</strong><span>一次设置，应用到整批</span></div></div>
      <span id="aspect-platform-label" className="toolbox-field-label">目标平台</span>
      <div role="radiogroup" aria-labelledby="aspect-platform-label">
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
      </div>
      <span id="aspect-strategy-label" className="toolbox-field-label">适配策略</span>
      <div role="radiogroup" aria-labelledby="aspect-strategy-label">
        <Radio.Group
          value={settings.strategy}
          disabled={disabled}
          onChange={event => onChange({ strategy: event.target.value })}
          options={FIT_STRATEGIES.filter(option => allowedStrategies.includes(option.value))}
        />
      </div>
      {settings.strategy === 'letterbox' && <p className="toolbox-hint">四周填充底色以适配目标比例，保留完整原图内容。</p>}
      {settings.strategy === 'outpaint' && (
        <>
          <span id="aspect-output-label" className="toolbox-field-label">输出模式</span>
          <div role="radiogroup" aria-labelledby="aspect-output-label">
            <Radio.Group
              value={settings.outpaintOutputMode ?? 'platform'}
              disabled={disabled}
              onChange={event => onChange({ outpaintOutputMode: event.target.value })}
              options={[
                { label: '按平台尺寸输出', value: 'platform' },
                { label: '保留原图分辨率', value: 'original' },
              ]}
            />
          </div>
          <p className="toolbox-hint">
            {settings.outpaintOutputMode === 'original'
              ? '原图保持原尺寸，向外智能补全背景；每张图片输出尺寸随原图变化，比例一致时保留原文件。'
              : `输出标准 ${preset.width} × ${preset.height} 平台尺寸，原图将按比例缩放并智能补全背景。`}
            预览中的深色区域为待补全画面。
          </p>
        </>
      )}
      {settings.strategy === 'outpaint' && outpaintStatus}
      {settings.strategy === 'letterbox' && (
        <>
          <div className="toolbox-field-row">
            <span>留白颜色</span>
            <button
              type="button"
              className="toolbox-color-trigger"
              aria-label={`留白颜色，当前 ${background.toUpperCase()}`}
              aria-haspopup="dialog"
              aria-expanded={colorDialogOpen}
              disabled={disabled || settings.background === 'transparent'}
              onClick={() => setColorDialogOpen(true)}
            >
              <span className="toolbox-color-swatch" style={{ background }} aria-hidden="true" />
              <span>{background.toUpperCase()}</span>
            </button>
          </div>
          <div role="radiogroup" aria-label="留白方式">
            <Radio.Group
              value={settings.background === 'transparent' ? 'transparent' : 'color'}
              disabled={disabled}
              onChange={event => onChange({ background: event.target.value === 'transparent' ? 'transparent' : '#ffffff' })}
              options={[{ label: '纯色', value: 'color' }, { label: '透明 PNG', value: 'transparent' }]}
              optionType="button"
            />
          </div>
        </>
      )}
      {settings.strategy === 'crop' && (
        <>
          <span id="aspect-focus-label" className="toolbox-field-label">裁剪焦点</span>
          <div className="toolbox-anchor-grid" role="group" aria-labelledby="aspect-focus-label">
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
          <p className="toolbox-hint">自动优先识别商品主体并居中裁剪；若未识别到主体，则按九宫格焦点位置裁剪。如裁剪偏移，可手动调整焦点后重新处理。</p>
        </>
      )}
      {templates}
      <ColorDialog
        open={colorDialogOpen}
        value={background}
        title="留白颜色"
        presetsLabel="常用留白颜色"
        idPrefix="aspect-ratio-color"
        onClose={() => setColorDialogOpen(false)}
        onApply={value => { onChange({ background: value }); setColorDialogOpen(false) }}
      />
    </section>
  )
}
