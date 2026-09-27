import type { ReactNode } from 'react'
import { Segmented } from 'antd'

export const TOOL_SWITCHER_COMING_SOON = '即将上线'

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

/** 工具箱与图片工作站共用：未就绪项写成「名称 · 即将上线」，不用单独徽章。 */
export function formatToolSwitcherLabel(label: string, ready = true) {
  return ready ? label : `${label} · ${TOOL_SWITCHER_COMING_SOON}`
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
