import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { App, Button, Input, Select } from 'antd'
import { SaveOutlined } from '@ant-design/icons'

interface Preset<T> { id: string; name: string; settings: T }
export interface PresetApi<T> {
  list: (scope: string) => Promise<Preset<T>[]>
  save: (scope: string, name: string, settings: T) => Promise<Preset<T>>
  remove: (id: string) => Promise<void>
}

export default function PresetControls<T extends object>({ scope, settings, api, disabled, onApply, validate, accepts }: {
  scope: string; settings: T; api: PresetApi<T>; disabled: boolean; onApply: (settings: T) => void
  validate?: () => boolean; accepts?: (settings: T) => boolean
}) {
  const { t } = useTranslation(['toolbox', 'common'])
  const { message } = App.useApp()
  const [presets, setPresets] = useState<Preset<T>[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const lifetime = useRef({ active: false })
  useEffect(() => {
    const current = { active: true }
    lifetime.current = current
    void api.list(scope).then(records => { if (current.active) setPresets(records) })
      .catch(error => { if (current.active) message.warning(t('presets.readFailed', { error: String(error) })) })
    return () => { current.active = false }
  }, [scope, api, message, t])
  const visible = accepts ? presets.filter(preset => accepts(preset.settings)) : presets
  const chosen = presets.find(preset => preset.id === selectedId)
  const currentId = chosen && Object.entries(chosen.settings).every(([key, value]) => Object.is(value, settings[key as keyof T])) ? selectedId : null
  const locked = disabled || saving
  async function save() {
    const trimmed = name.trim()
    if (!trimmed) { message.warning(t('presets.enterName')); return }
    if (presets.some(preset => preset.name === trimmed)) { message.warning(t('presets.duplicateName')); return }
    if (validate && !validate()) { message.warning(t('presets.enterWatermarkFirst')); return }
    const current = lifetime.current
    setSaving(true)
    try {
      const preset = await api.save(scope, trimmed, settings)
      if (!current.active) return
      setPresets(current => [preset, ...current]); setSelectedId(preset.id); setName('')
      message.success(t('presets.savedLocal'))
    } catch (error) { if (current.active) message.error(String(error)) }
    finally { if (current.active) setSaving(false) }
  }
  async function remove() {
    if (!selectedId) return
    const current = lifetime.current
    setSaving(true)
    try {
      await api.remove(selectedId)
      if (!current.active) return
      setPresets(current => current.filter(preset => preset.id !== selectedId)); setSelectedId(null)
      message.success(t('presets.deleted'))
    } catch (error) { if (current.active) message.error(String(error)) }
    finally { if (current.active) setSaving(false) }
  }
  return <div className="toolbox-presets">
    <label className="toolbox-field-label">{t('aspectRatio.localTemplate')}</label>
    <div className="toolbox-preset-row">
      <Select placeholder={t('presets.selectPlaceholder')} value={currentId} disabled={locked}
        options={visible.map(preset => ({ value: preset.id, label: preset.name }))} allowClear onClear={() => setSelectedId(null)}
        onChange={id => { const preset = visible.find(preset => preset.id === id); if (preset) { onApply(preset.settings); setSelectedId(id) } }} />
      <Button disabled={!currentId || locked} onClick={() => void remove()}>{t('common:actions.delete')}</Button>
    </div>
    <div className="toolbox-preset-row">
      <Input value={name} maxLength={40} disabled={locked} placeholder={t('presets.newNamePlaceholder')} onChange={event => setName(event.target.value)} onPressEnter={() => void save()} />
      <Button icon={<SaveOutlined />} disabled={locked} onClick={() => void save()}>{t('common:actions.save')}</Button>
    </div>
  </div>
}
