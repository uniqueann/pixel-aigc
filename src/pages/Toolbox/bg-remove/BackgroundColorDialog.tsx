import { useRef, useState, type RefObject } from 'react'
import { Button, Input, Modal } from 'antd'
import { hexForColorInput, normalizeHex } from './color'

const PRESETS = [
  { label: '白色', value: '#FFFFFF' },
  { label: '黑色', value: '#000000' },
  { label: '品牌绿', value: '#21CFA0' },
  { label: '浅灰', value: '#F5F5F5' },
] as const

interface Props {
  open: boolean
  value: string
  onClose: () => void
  onApply: (value: string) => void
}

interface BodyProps {
  value: string
  firstPresetRef: RefObject<HTMLButtonElement>
  onClose: () => void
  onApply: (value: string) => void
}

// 表单单独拆成子组件：Modal 的 destroyOnHidden 会在关闭后卸载它，
// 下次打开自然回到当前生效颜色，不需要 effect 或 key 重挂载 Modal。
function ColorDialogBody({ value, firstPresetRef, onClose, onApply }: BodyProps) {
  const [draft, setDraft] = useState(() => hexForColorInput(value))
  const [hexInput, setHexInput] = useState(() => hexForColorInput(value))
  const [error, setError] = useState<string | null>(null)

  function choose(next: string) {
    const normalized = normalizeHex(next)
    if (!normalized) return
    setDraft(normalized)
    setHexInput(normalized)
    setError(null)
  }

  function commitHex() {
    const normalized = normalizeHex(hexInput)
    if (!normalized) {
      setError('请输入 #RGB 或 #RRGGBB 格式的颜色值')
      return
    }
    setDraft(normalized)
    setHexInput(normalized)
    setError(null)
  }

  function apply() {
    const normalized = normalizeHex(hexInput)
    if (!normalized) {
      setError('请输入 #RGB 或 #RRGGBB 格式的颜色值')
      return
    }
    onApply(normalized)
    onClose()
  }

  return (
    <div className="bg-color-dialog-body">
      <div className="bg-color-preview" style={{ background: draft }} aria-hidden="true" />
      <div className="bg-color-presets" role="group" aria-labelledby="bg-color-presets-label">
        <span id="bg-color-presets-label" className="bg-color-label">常用背景色</span>
        {PRESETS.map((preset, index) => {
          const active = draft === preset.value
          return (
            <button
              key={preset.value}
              ref={index === 0 ? firstPresetRef : undefined}
              type="button"
              className={`bg-color-preset${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => choose(preset.value)}
            >
              <span className="bg-color-swatch" style={{ background: preset.value }} aria-hidden="true" />
              <span>{preset.label}</span>
              <code>{preset.value}</code>
            </button>
          )
        })}
      </div>
      <div className="bg-color-field">
        <label htmlFor="bg-color-custom">自定义颜色</label>
        <input
          id="bg-color-custom"
          type="color"
          value={hexForColorInput(draft)}
          onChange={event => choose(event.target.value)}
        />
      </div>
      <div className="bg-color-field">
        <label htmlFor="bg-color-hex">十六进制颜色值</label>
        <Input
          id="bg-color-hex"
          value={hexInput}
          onChange={event => { setHexInput(event.target.value); setError(null) }}
          onBlur={commitHex}
          onPressEnter={commitHex}
          status={error ? 'error' : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'bg-color-hex-error' : undefined}
        />
        {error && <p id="bg-color-hex-error" className="bg-color-error" role="alert">{error}</p>}
      </div>
      <div className="bg-color-dialog-actions">
        <Button onClick={onClose}>取消</Button>
        <Button type="primary" onClick={apply} disabled={Boolean(error)}>应用颜色</Button>
      </div>
    </div>
  )
}

export default function BackgroundColorDialog({ open, value, onClose, onApply }: Props) {
  const firstPresetRef = useRef<HTMLButtonElement>(null)

  return (
    <Modal
      open={open}
      title="背景颜色"
      footer={null}
      centered
      width={380}
      className="bg-color-dialog"
      destroyOnHidden
      focusTriggerAfterClose
      onCancel={onClose}
      afterOpenChange={visible => { if (visible) firstPresetRef.current?.focus() }}
    >
      <ColorDialogBody
        value={value}
        firstPresetRef={firstPresetRef}
        onClose={onClose}
        onApply={onApply}
      />
    </Modal>
  )
}
