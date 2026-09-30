import type { ReactNode } from 'react'
import { Segmented } from 'antd'
import { formatToolSwitcherLabel } from './toolSwitcherLabel'

export interface ToolSwitcherOption {
  value: string
  label: string
  ready?: boolean
  icon?: ReactNode
}

interface Props {
  options: ToolSwitcherOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}

export default function ToolSwitcher({ options, value, onChange, className }: Props) {
  return (
    <div className={['tool-switcher', className].filter(Boolean).join(' ')}>
      <Segmented
        options={options.map((option) => {
          const text = formatToolSwitcherLabel(option.label, option.ready !== false)
          return {
            value: option.value,
            icon: option.icon,
            label: text,
          }
        })}
        value={value}
        onChange={(next) => onChange(String(next))}
      />
    </div>
  )
}
