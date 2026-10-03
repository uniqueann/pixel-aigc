import { useEffect, useRef, useState } from 'react'
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
      .catch(error => { if (current.active) message.warning(`读取本机模板失败：${String(error)}`) })
    return () => { current.active = false }
  }, [scope, api, message])
  const visible = accepts ? presets.filter(preset => accepts(preset.settings)) : presets
  const chosen = presets.find(preset => preset.id === selectedId)
  const currentId = chosen && Object.entries(chosen.settings).every(([key, value]) => Object.is(value, settings[key as keyof T])) ? selectedId : null
  const locked = disabled || saving
  async function save() {
    const trimmed = name.trim()
    if (!trimmed) { message.warning('请先输入模板名称'); return }
    if (presets.some(preset => preset.name === trimmed)) { message.warning('模板名称已存在'); return }
    if (validate && !validate()) { message.warning('请先设置水印内容'); return }
    const current = lifetime.current
    setSaving(true)
    try {
      const preset = await api.save(scope, trimmed, settings)
      if (!current.active) return
      setPresets(current => [preset, ...current]); setSelectedId(preset.id); setName('')
      message.success('模板已保存在本机')
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
      message.success('模板已删除')
    } catch (error) { if (current.active) message.error(String(error)) }
    finally { if (current.active) setSaving(false) }
  }
  return <div className="toolbox-presets">
    <label className="toolbox-field-label">本机模板</label>
    <div className="toolbox-preset-row">
      <Select placeholder="选择已保存模板" value={currentId} disabled={locked}
        options={visible.map(preset => ({ value: preset.id, label: preset.name }))} allowClear onClear={() => setSelectedId(null)}
        onChange={id => { const preset = visible.find(preset => preset.id === id); if (preset) { onApply(preset.settings); setSelectedId(id) } }} />
      <Button disabled={!currentId || locked} onClick={() => void remove()}>删除</Button>
    </div>
    <div className="toolbox-preset-row">
      <Input value={name} maxLength={40} disabled={locked} placeholder="新模板名称" onChange={event => setName(event.target.value)} onPressEnter={() => void save()} />
      <Button icon={<SaveOutlined />} disabled={locked} onClick={() => void save()}>保存</Button>
    </div>
  </div>
}
