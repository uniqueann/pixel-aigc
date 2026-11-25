import { useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input, Modal } from 'antd'
import { hexForColorInput, normalizeHex } from './color'

export interface ColorPreset {
  label: string
  value: string
}

interface Props {
  open: boolean
  value: string
  onClose: () => void
  onApply: (value: string) => void
  title?: string
  presetsLabel?: string
  presets?: readonly ColorPreset[]
  idPrefix?: string
}

interface BodyProps extends Required<Pick<Props, 'value' | 'onClose' | 'onApply'>> {
  firstPresetRef: RefObject<HTMLButtonElement>
  presetsLabel: string
  presets: readonly ColorPreset[]
  idPrefix: string
}

// 表单单独拆成子组件：Modal 的 destroyOnHidden 会在关闭后卸载它，
// 下次打开自然回到当前生效颜色，不需要 effect 或 key 重挂载 Modal。
function ColorDialogBody({ value, firstPresetRef, onClose, onApply, presetsLabel, presets, idPrefix }: BodyProps) {
  const { t } = useTranslation(['toolbox', 'common'])
  const [draft, setDraft] = useState(() => hexForColorInput(value))
  const [hexInput, setHexInput] = useState(() => hexForColorInput(value))
  const [error, setError] = useState<string | null>(null)
  const presetsLabelId = `${idPrefix}-presets-label`
  const hexErrorId = `${idPrefix}-hex-error`

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
      setError(t('colorDialog.invalidHex'))
      return
    }
    setDraft(normalized)
    setHexInput(normalized)
    setError(null)
  }

  function apply() {
    const normalized = normalizeHex(hexInput)
    if (!normalized) {
      setError(t('colorDialog.invalidHex'))
      return
    }
    onApply(normalized)
    onClose()
  }

  return (
    <div className="bg-color-dialog-body">
      <div className="bg-color-preview" style={{ background: draft }} aria-hidden="true" />
      <div className="bg-color-presets" role="group" aria-labelledby={presetsLabelId}>
        <span id={presetsLabelId} className="bg-color-label">{presetsLabel}</span>
        {presets.map((preset, index) => {
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
        <label htmlFor={`${idPrefix}-custom`}>{t('colorDialog.customColor')}</label>
        <input
          id={`${idPrefix}-custom`}
          type="color"
          value={hexForColorInput(draft)}
          onChange={event => choose(event.target.value)}
        />
      </div>
      <div className="bg-color-field">
        <label htmlFor={`${idPrefix}-hex`}>{t('colorDialog.hexValue')}</label>
        <Input
          id={`${idPrefix}-hex`}
          value={hexInput}
          onChange={event => { setHexInput(event.target.value); setError(null) }}
          onBlur={commitHex}
          onPressEnter={commitHex}
          status={error ? 'error' : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? hexErrorId : undefined}
        />
        {error && <p id={hexErrorId} className="bg-color-error" role="alert">{error}</p>}
      </div>
      <div className="bg-color-dialog-actions">
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button type="primary" onClick={apply} disabled={Boolean(error)}>{t('colorDialog.apply')}</Button>
      </div>
    </div>
  )
}

export default function ColorDialog({
  open,
  value,
  onClose,
  onApply,
  title,
  presetsLabel,
  presets,
  idPrefix = 'bg-color',
}: Props) {
  const { t } = useTranslation('toolbox')
  const firstPresetRef = useRef<HTMLButtonElement>(null)
  const resolvedTitle = title ?? t('colorDialog.defaultTitle')
  const resolvedPresetsLabel = presetsLabel ?? t('colorDialog.defaultPresetsLabel')
  const resolvedPresets: readonly ColorPreset[] = presets ?? [
    { label: t('colors.white'), value: '#FFFFFF' },
    { label: t('colors.black'), value: '#000000' },
    { label: t('colors.brandGreen'), value: '#21CFA0' },
    { label: t('colors.lightGray'), value: '#F5F5F5' },
  ]

  return (
    <Modal
      open={open}
      title={resolvedTitle}
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
        presetsLabel={resolvedPresetsLabel}
        presets={resolvedPresets}
        idPrefix={idPrefix}
      />
    </Modal>
  )
}
