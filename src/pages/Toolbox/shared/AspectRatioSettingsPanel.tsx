import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Radio } from 'antd'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { activeLocale } from '@/i18n/format'
import { FIT_STRATEGIES, getFitStrategyLabel } from '../aspect-ratio/strategies'
import type { AspectRatioSettings, FitStrategy } from '../aspect-ratio/types'
import ColorDialog from './ColorDialog'
import { getPlatformPresetLabel } from './presetLabels'

const focuses = [
  { fx: 0, fy: 0, key: 'top-left' as const },
  { fx: 0.5, fy: 0, key: 'top-center' as const },
  { fx: 1, fy: 0, key: 'top-right' as const },
  { fx: 0, fy: 0.5, key: 'middle-left' as const },
  { fx: 0.5, fy: 0.5, key: 'middle-center' as const },
  { fx: 1, fy: 0.5, key: 'middle-right' as const },
  { fx: 0, fy: 1, key: 'bottom-left' as const },
  { fx: 0.5, fy: 1, key: 'bottom-center' as const },
  { fx: 1, fy: 1, key: 'bottom-right' as const },
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
  const { t } = useTranslation('toolbox')
  const [colorDialogOpen, setColorDialogOpen] = useState(false)
  const preset = PLATFORM_SIZE_PRESETS.find(item => item.id === settings.selectedPresetId) ?? PLATFORM_SIZE_PRESETS[0]
  const background = settings.background === 'transparent' ? '#ffffff' : settings.background
  return (
    <section className="toolbox-settings-panel" aria-label={t('aspectRatio.settingsAria')}>
      <div className="toolbox-section-heading"><div><strong>{t('aspectRatio.settingsTitle')}</strong><span>{t('shared.applyToBatch')}</span></div></div>
      <span id="aspect-platform-label" className="toolbox-field-label">{t('aspectRatio.targetPlatform')}</span>
      <div role="radiogroup" aria-labelledby="aspect-platform-label">
        <Radio.Group
          value={preset.id}
          disabled={disabled}
          onChange={event => onChange({ selectedPresetId: event.target.value })}
        >
          {PLATFORM_SIZE_PRESETS.map(item => (
            <Radio key={item.id} value={item.id} style={{ display: 'flex', marginBottom: 6 }}>
              {getPlatformPresetLabel(item.id, item.label)} {item.width} × {item.height}
            </Radio>
          ))}
        </Radio.Group>
      </div>
      <span id="aspect-strategy-label" className="toolbox-field-label">{t('aspectRatio.strategyLabel')}</span>
      <div role="radiogroup" aria-labelledby="aspect-strategy-label">
        <Radio.Group
          value={settings.strategy}
          disabled={disabled}
          onChange={event => onChange({ strategy: event.target.value })}
          options={FIT_STRATEGIES.filter(option => allowedStrategies.includes(option.value)).map(option => ({
            value: option.value,
            label: getFitStrategyLabel(option.value),
          }))}
        />
      </div>
      {settings.strategy === 'letterbox' && <p className="toolbox-hint">{t('aspectRatio.letterboxHint')}</p>}
      {settings.strategy === 'outpaint' && (
        <>
          <span id="aspect-output-label" className="toolbox-field-label">{t('aspectRatio.outputModeLabel')}</span>
          <div role="radiogroup" aria-labelledby="aspect-output-label">
            <Radio.Group
              value={settings.outpaintOutputMode ?? 'platform'}
              disabled={disabled}
              onChange={event => onChange({ outpaintOutputMode: event.target.value })}
              options={[
                { label: t('aspectRatio.outputModes.platform'), value: 'platform' },
                { label: t('aspectRatio.outputModes.original'), value: 'original' },
              ]}
            />
          </div>
          <p className="toolbox-hint">
            {settings.outpaintOutputMode === 'original'
              ? t('aspectRatio.outpaintOriginalHint')
              : t('aspectRatio.outpaintPlatformHint', { width: preset.width, height: preset.height })}
            {activeLocale() === 'en-US' ? ' ' : ''}{t('aspectRatio.outpaintDarkAreaHint')}
          </p>
        </>
      )}
      {settings.strategy === 'outpaint' && outpaintStatus}
      {settings.strategy === 'letterbox' && (
        <>
          <div className="toolbox-field-row">
            <span>{t('aspectRatio.letterboxColor')}</span>
            <button
              type="button"
              className="toolbox-color-trigger"
              aria-label={t('aspectRatio.letterboxColorAria', { color: background.toUpperCase() })}
              aria-haspopup="dialog"
              aria-expanded={colorDialogOpen}
              disabled={disabled || settings.background === 'transparent'}
              onClick={() => setColorDialogOpen(true)}
            >
              <span className="toolbox-color-swatch" style={{ background }} aria-hidden="true" />
              <span>{background.toUpperCase()}</span>
            </button>
          </div>
          <div className="toolbox-background-options" role="radiogroup" aria-label={t('aspectRatio.letterboxModeAria')}>
            <Radio.Group
              value={settings.background === 'transparent' ? 'transparent' : 'color'}
              disabled={disabled}
              onChange={event => onChange({ background: event.target.value === 'transparent' ? 'transparent' : '#ffffff' })}
              options={[
                { label: t('bgRemove.solidColor'), value: 'color' },
                { label: t('bgRemove.transparentPng'), value: 'transparent' },
              ]}
              optionType="button"
            />
          </div>
        </>
      )}
      {settings.strategy === 'crop' && (
        <>
          <span id="aspect-focus-label" className="toolbox-field-label">{t('aspectRatio.cropFocusLabel')}</span>
          <div className="toolbox-anchor-grid" role="group" aria-labelledby="aspect-focus-label">
            {focuses.map(focus => (
              <button
                key={focus.key}
                type="button"
                className={settings.fx === focus.fx && settings.fy === focus.fy ? 'is-active' : ''}
                disabled={disabled}
                onClick={() => onChange({ fx: focus.fx, fy: focus.fy })}
              >
                {t(`anchors.${focus.key}`)}
              </button>
            ))}
          </div>
          <p className="toolbox-hint">{t('aspectRatio.cropFocusHint')}</p>
        </>
      )}
      {templates}
      <ColorDialog
        open={colorDialogOpen}
        value={background}
        title={t('aspectRatio.letterboxColorTitle')}
        presetsLabel={t('aspectRatio.letterboxColorPresets')}
        idPrefix="aspect-ratio-color"
        onClose={() => setColorDialogOpen(false)}
        onApply={value => { onChange({ background: value }); setColorDialogOpen(false) }}
      />
    </section>
  )
}
