import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Radio, Slider, Switch, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import type { WatermarkAnchor, WatermarkSettings } from '../watermark/types'
import ColorDialog, { type ColorPreset } from './ColorDialog'

const anchorValues: readonly WatermarkAnchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

interface Props {
  settings: WatermarkSettings
  disabled: boolean
  onChange: (patch: Partial<WatermarkSettings>) => void
  onLogo: (file: File) => void | Promise<void>
  templates?: ReactNode
}

export default function WatermarkSettingsPanel({ settings, disabled, onChange, onLogo, templates }: Props) {
  const { t } = useTranslation('toolbox')
  const [colorDialogOpen, setColorDialogOpen] = useState(false)
  const textColorPresets: readonly ColorPreset[] = [
    { label: t('colors.white'), value: '#FFFFFF' },
    { label: t('colors.black'), value: '#000000' },
    { label: t('colors.brandGreen'), value: '#21CFA0' },
    { label: t('colors.darkGray'), value: '#374151' },
  ]
  return (
    <section className="toolbox-settings-panel" aria-label={t('watermark.settingsAria')}>
      <div className="toolbox-section-heading"><div><strong>{t('watermark.settingsTitle')}</strong><span>{t('shared.applyToBatch')}</span></div></div>
      <div role="radiogroup" aria-label={t('watermark.typeAria')}>
        <Radio.Group
          value={settings.kind}
          disabled={disabled}
          onChange={event => onChange({ kind: event.target.value })}
          options={[
            { label: t('watermark.textType'), value: 'text' },
            { label: t('watermark.logoType'), value: 'logo' },
          ]}
          optionType="button"
          buttonStyle="solid"
        />
      </div>
      {settings.kind === 'text' ? (
        <>
          <label className="toolbox-field-label" htmlFor="watermark-text">{t('watermark.textLabel')}</label>
          <Input id="watermark-text" value={settings.text} maxLength={80} disabled={disabled} placeholder={t('watermark.textPlaceholder')} onChange={event => onChange({ text: event.target.value })} />
          <span id="watermark-color-label" className="toolbox-field-label">{t('watermark.textColorLabel')}</span>
          <div className="toolbox-layout-options" role="radiogroup" aria-labelledby="watermark-color-label">
            <Radio.Group
              value={settings.colorMode}
              disabled={disabled}
              onChange={event => onChange({ colorMode: event.target.value })}
              options={[
                { label: t('watermark.colorAuto'), value: 'auto' },
                { label: t('watermark.colorCustom'), value: 'custom' },
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </div>
          {settings.colorMode === 'custom' && (
            <>
              <div className="toolbox-field-row">
                <span>{t('watermark.customColor')}</span>
                <button
                  type="button"
                  className="toolbox-color-trigger"
                  aria-label={t('watermark.customColorAria', { color: settings.color.toUpperCase() })}
                  aria-haspopup="dialog"
                  aria-expanded={colorDialogOpen}
                  disabled={disabled}
                  onClick={() => setColorDialogOpen(true)}
                >
                  <span className="toolbox-color-swatch" style={{ background: settings.color }} aria-hidden="true" />
                  <span>{settings.color.toUpperCase()}</span>
                </button>
              </div>
              <ColorDialog
                open={colorDialogOpen}
                value={settings.color}
                title={t('watermark.colorDialogTitle')}
                presetsLabel={t('watermark.colorDialogPresets')}
                presets={textColorPresets}
                idPrefix="watermark-color"
                onClose={() => setColorDialogOpen(false)}
                onApply={color => onChange({ color })}
              />
            </>
          )}
          <div className="toolbox-field-row">
            <span>{t('watermark.readabilityStroke')}</span>
            <Switch checked={settings.readability} disabled={disabled} aria-label={t('watermark.readabilityStroke')} onChange={checked => onChange({ readability: checked })} />
          </div>
          <p className="toolbox-hint">{t('watermark.readabilityHint')}</p>
          <label className="toolbox-field-label" id="watermark-text-size-label">{t('watermark.textSizeLabel', { value: settings.textSizePercent })}</label>
          <Slider
            min={1}
            max={15}
            value={settings.textSizePercent}
            disabled={disabled}
            ariaLabelledByForHandle="watermark-text-size-label"
            ariaValueTextFormatterForHandle={value => t('watermark.shortEdgeValue', { value })}
            onChange={value => onChange({ textSizePercent: value })}
          />
        </>
      ) : (
        <>
          <label className="toolbox-field-label">{t('watermark.logoImageLabel')}</label>
          <Upload accept="image/png,image/webp" showUploadList={false} disabled={disabled} beforeUpload={file => { void onLogo(file); return Upload.LIST_IGNORE }}>
            <Button icon={<UploadOutlined />} disabled={disabled}>{t('watermark.chooseLogoBtn')}</Button>
          </Upload>
          <span className="toolbox-logo-name" title={settings.logoName ?? ''}>{settings.logoName ?? t('watermark.logoHint')}</span>
          <label className="toolbox-field-label" id="watermark-logo-size-label">{t('watermark.logoSizeLabel', { value: settings.logoSizePercent })}</label>
          <Slider
            min={5}
            max={50}
            value={settings.logoSizePercent}
            disabled={disabled}
            ariaLabelledByForHandle="watermark-logo-size-label"
            ariaValueTextFormatterForHandle={value => t('watermark.shortEdgeValue', { value })}
            onChange={value => onChange({ logoSizePercent: value })}
          />
        </>
      )}
      <label className="toolbox-field-label" id="watermark-layout-label">{t('watermark.layoutLabel')}</label>
      <div className="toolbox-layout-options" role="radiogroup" aria-labelledby="watermark-layout-label">
        <Radio.Group
          value={settings.layout}
          disabled={disabled}
          onChange={event => onChange({ layout: event.target.value })}
          options={[
            { label: t('watermark.layoutSingle'), value: 'single' },
            { label: t('watermark.layoutTile'), value: 'tile' },
          ]}
          optionType="button"
          buttonStyle="solid"
        />
      </div>
      {settings.layout === 'tile' ? (
        <>
          <label className="toolbox-field-label" id="watermark-tile-gap-label">{t('watermark.tileGapLabel', { value: settings.tileGapPercent })}</label>
          <Slider
            min={0}
            max={30}
            value={settings.tileGapPercent}
            disabled={disabled}
            ariaLabelledByForHandle="watermark-tile-gap-label"
            ariaValueTextFormatterForHandle={value => t('watermark.shortEdgeValue', { value })}
            onChange={value => onChange({ tileGapPercent: value })}
          />
          <label className="toolbox-field-label" id="watermark-tile-rotation-label">{t('watermark.tileRotationLabel', { value: settings.tileRotation })}</label>
          <Slider
            min={-60}
            max={60}
            value={settings.tileRotation}
            disabled={disabled}
            ariaLabelledByForHandle="watermark-tile-rotation-label"
            ariaValueTextFormatterForHandle={value => t('watermark.degreesValue', { value })}
            onChange={value => onChange({ tileRotation: value })}
          />
        </>
      ) : (
        <>
          <span id="watermark-anchor-label" className="toolbox-field-label">{t('watermark.anchorLabel')}</span>
          <div className="toolbox-anchor-grid" role="group" aria-labelledby="watermark-anchor-label">
            {anchorValues.map(anchor => {
              const label = t(`anchors.${anchor}`)
              return (
                <button
                  key={anchor}
                  type="button"
                  className={settings.anchor === anchor ? 'is-active' : ''}
                  disabled={disabled}
                  aria-label={label}
                  aria-pressed={settings.anchor === anchor}
                  title={label}
                  onClick={() => onChange({ anchor })}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </>
      )}
      <label className="toolbox-field-label" id="watermark-opacity-label">{t('watermark.opacityLabel', { value: settings.opacity })}</label>
      <Slider
        min={10}
        max={100}
        value={settings.opacity}
        disabled={disabled}
        ariaLabelledByForHandle="watermark-opacity-label"
        ariaValueTextFormatterForHandle={value => `${value}%`}
        onChange={value => onChange({ opacity: value })}
      />
      {settings.layout === 'single' && (
        <>
          <label className="toolbox-field-label" id="watermark-margin-label">{t('watermark.marginLabel', { value: settings.marginPercent })}</label>
          <Slider
            min={0}
            max={10}
            value={settings.marginPercent}
            disabled={disabled}
            ariaLabelledByForHandle="watermark-margin-label"
            ariaValueTextFormatterForHandle={value => t('watermark.shortEdgeValue', { value })}
            onChange={value => onChange({ marginPercent: value })}
          />
        </>
      )}
      {templates}
    </section>
  )
}
