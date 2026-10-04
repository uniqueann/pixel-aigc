import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Segmented } from 'antd'
import { formatToolSwitcherLabel } from './toolSwitcherLabel'
import { scrollEdges, scrollSelectedIntoView } from './toolSwitcherScroll'

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
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const updateEdges = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const next = scrollEdges(el)
    setEdges((current) => (current.left === next.left && current.right === next.right ? current : next))
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    updateEdges()
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver === 'function') {
      try { observer = new ResizeObserver(() => updateEdges()) } catch { observer = undefined }
    }
    observer?.observe(el)
    if (el.firstElementChild) observer?.observe(el.firstElementChild)
    const onScroll = () => updateEdges()
    el.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', updateEdges)
    return () => {
      observer?.disconnect()
      el.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', updateEdges)
    }
  }, [updateEdges, options, value])

  useEffect(() => {
    const el = scrollerRef.current
    const selected = el?.querySelector<HTMLElement>('.ant-segmented-item-selected')
    if (!el || !selected) return
    scrollSelectedIntoView(el, selected)
    updateEdges()
  }, [value, options, updateEdges])

  return (
    <div className={['tool-switcher-frame', className].filter(Boolean).join(' ')}>
      <span className={edges.left ? 'tool-switcher-fade is-left is-visible' : 'tool-switcher-fade is-left'} aria-hidden="true" />
      <div ref={scrollerRef} className="tool-switcher">
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
      <span className={edges.right ? 'tool-switcher-fade is-right is-visible' : 'tool-switcher-fade is-right'} aria-hidden="true" />
    </div>
  )
}
