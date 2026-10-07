import { Select } from 'antd'
import type { CSSProperties } from 'react'

export interface ModelChoiceOption {
  id: string
  label: string
}

interface Props {
  label?: string
  ariaLabel: string
  models: ModelChoiceOption[]
  value?: string
  disabled?: boolean
  loading?: boolean
  placeholder?: string
  onChange?: (id: string) => void
  className?: string
  selectStyle?: CSSProperties
}

/** 只有一个可选项时直接显示名称；两个及以上才使用下拉框。 */
export default function ModelChoice({
  label,
  ariaLabel,
  models,
  value,
  disabled,
  loading,
  placeholder,
  onChange,
  className,
  selectStyle,
}: Props) {
  const selected = models.find(item => item.id === value) ?? models[0]
  const named = Boolean(className || label)
  if (models.length === 1 && selected) {
    const name = <span className="model-choice-static">{selected.label}</span>
    return named ? <label className={className}><span>{label}</span>{name}</label> : name
  }
  if (models.length === 0 && !loading && !placeholder) return null
  const select = (
    <Select
      aria-label={ariaLabel}
      style={selectStyle ?? { width: '100%' }}
      value={models.length ? value : undefined}
      placeholder={placeholder}
      loading={loading}
      disabled={disabled}
      onChange={onChange}
      options={models.map(item => ({ value: item.id, label: item.label }))}
    />
  )
  return named ? <label className={className}><span>{label}</span>{select}</label> : select
}
