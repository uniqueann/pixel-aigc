import type { ReactNode } from 'react'
import { Button, ColorPicker, Input, Radio, Slider, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import type { WatermarkAnchor, WatermarkSettings } from '../watermark/types'

const anchors: { value: WatermarkAnchor; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '上中' },
  { value: 'top-right', label: '右上' },
  { value: 'middle-left', label: '左中' },
  { value: 'middle-center', label: '正中' },
  { value: 'middle-right', label: '右中' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '下中' },
  { value: 'bottom-right', label: '右下' },
]

interface Props {
  settings: WatermarkSettings
  disabled: boolean
  onChange: (patch: Partial<WatermarkSettings>) => void
  onLogo: (file: File) => void | Promise<void>
  templates?: ReactNode
}

export default function WatermarkSettingsPanel({ settings, disabled, onChange, onLogo, templates }: Props) {
  return (
    <section className="toolbox-settings-panel" aria-label="水印设置">
      <div className="toolbox-section-heading"><div><strong>水印设置</strong><span>一次设置，应用到整批</span></div></div>
      <Radio.Group
        value={settings.kind}
        disabled={disabled}
        onChange={event => onChange({ kind: event.target.value })}
        options={[{ label: '文字水印', value: 'text' }, { label: 'Logo 水印', value: 'logo' }]}
        optionType="button"
        buttonStyle="solid"
      />
      {settings.kind === 'text' ? (
        <>
          <label className="toolbox-field-label" htmlFor="watermark-text">水印文字</label>
          <Input id="watermark-text" value={settings.text} maxLength={80} disabled={disabled} placeholder="例如：© 我的品牌" onChange={event => onChange({ text: event.target.value })} />
          <div className="toolbox-field-row"><span>文字颜色</span><ColorPicker value={settings.color} disabled={disabled} onChange={color => onChange({ color: color.toHexString() })} /></div>
          <label className="toolbox-field-label">文字大小：短边的 {settings.textSizePercent}%</label>
          <Slider min={1} max={15} value={settings.textSizePercent} disabled={disabled} onChange={value => onChange({ textSizePercent: value })} />
        </>
      ) : (
        <>
          <label className="toolbox-field-label">Logo 图片</label>
          <Upload accept="image/png,image/webp" showUploadList={false} disabled={disabled} beforeUpload={file => { void onLogo(file); return Upload.LIST_IGNORE }}>
            <Button icon={<UploadOutlined />} disabled={disabled}>选择 PNG / WebP</Button>
          </Upload>
          <span className="toolbox-logo-name" title={settings.logoName ?? ''}>{settings.logoName ?? '推荐使用透明背景 Logo'}</span>
          <label className="toolbox-field-label">Logo 宽度：短边的 {settings.logoSizePercent}%</label>
          <Slider min={5} max={50} value={settings.logoSizePercent} disabled={disabled} onChange={value => onChange({ logoSizePercent: value })} />
        </>
      )}
      <label className="toolbox-field-label">排列方式</label>
      <Radio.Group
        className="toolbox-layout-options"
        value={settings.layout}
        disabled={disabled}
        onChange={event => onChange({ layout: event.target.value })}
        options={[{ label: '单个', value: 'single' }, { label: '平铺', value: 'tile' }]}
        optionType="button"
        buttonStyle="solid"
      />
      {settings.layout === 'tile' ? (
        <>
          <label className="toolbox-field-label">平铺间距：短边的 {settings.tileGapPercent}%</label>
          <Slider min={0} max={30} value={settings.tileGapPercent} disabled={disabled} onChange={value => onChange({ tileGapPercent: value })} />
          <label className="toolbox-field-label">旋转角度：{settings.tileRotation}°</label>
          <Slider min={-60} max={60} value={settings.tileRotation} disabled={disabled} onChange={value => onChange({ tileRotation: value })} />
        </>
      ) : (
        <>
          <label className="toolbox-field-label">位置</label>
          <div className="toolbox-anchor-grid">
            {anchors.map(anchor => <button key={anchor.value} type="button" className={settings.anchor === anchor.value ? 'is-active' : ''} disabled={disabled} aria-label={anchor.label} title={anchor.label} onClick={() => onChange({ anchor: anchor.value })}>{anchor.label}</button>)}
          </div>
        </>
      )}
      <label className="toolbox-field-label">透明度：{settings.opacity}%</label>
      <Slider min={10} max={100} value={settings.opacity} disabled={disabled} onChange={value => onChange({ opacity: value })} />
      {settings.layout === 'single' && (
        <>
          <label className="toolbox-field-label">边距：短边的 {settings.marginPercent}%</label>
          <Slider min={0} max={10} value={settings.marginPercent} disabled={disabled} onChange={value => onChange({ marginPercent: value })} />
        </>
      )}
      {templates}
    </section>
  )
}
