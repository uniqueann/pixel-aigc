import { Select } from 'antd'
import type { CSSProperties, ReactNode } from 'react'
import { imageModelHint, imageModelVendor, isImageModelVendor, type ImageModelHintScope, type ImageModelVendor } from '@shared/image-models'
import ModelVendorMark from './ModelVendorMark'

export interface ModelChoiceOption {
  id: string
  label: string
  /** 目录里的厂商。缺省时按模型 id 识别；未知厂商不显示图标。 */
  vendor?: string
  hints?: Partial<Record<ImageModelHintScope, string>>
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
  /** 下拉选项里的短标签。已选项和单模型名称不显示。 */
  hintScope?: ImageModelHintScope
}

function vendorOf(option: ModelChoiceOption): ImageModelVendor | undefined {
  if (isImageModelVendor(option.vendor)) return option.vendor
  return imageModelVendor(option.id)
}

function ModelName({ option }: { option: ModelChoiceOption }) {
  const vendor = vendorOf(option)
  return (
    <span className="model-choice-name">
      {vendor ? <ModelVendorMark vendor={vendor} /> : null}
      <span>{option.label}</span>
    </span>
  )
}

function choiceLabel(option: ModelChoiceOption): ReactNode {
  return <ModelName option={option} />
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
  hintScope = 'text_to_image',
}: Props) {
  const selected = models.find(item => item.id === value) ?? models[0]
  const named = Boolean(className || label)
  if (models.length === 1 && selected) {
    const name = <span className="model-choice-static"><ModelName option={selected} /></span>
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
      options={models.map(item => ({
        value: item.id,
        title: item.label,
        hint: imageModelHint(item, hintScope),
        label: choiceLabel(item),
      }))}
      optionRender={(option) => {
        const hint = (option.data as { hint?: string }).hint
        return (
          <span className="model-choice-option">
            {option.label}
            {hint ? <span className="model-choice-hint">{hint}</span> : null}
          </span>
        )
      }}
    />
  )
  return named ? <label className={className}><span>{label}</span>{select}</label> : select
}
