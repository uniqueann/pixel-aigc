// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ToolSwitcher from './ToolSwitcher'
import { scrollEdges, scrollSelectedIntoView } from './toolSwitcherScroll'
import { formatToolSwitcherLabel, TOOL_SWITCHER_COMING_SOON } from './toolSwitcherLabel'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('工具切换器', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(() => {
    act(() => { root?.unmount() })
    host?.remove()
    root = undefined
    host = undefined
  })

  it('未就绪工具与工具箱一样写成「名称 · 即将上线」', () => {
    expect(formatToolSwitcherLabel('智能抠图', false)).toBe('智能抠图 · 即将上线')
    expect(formatToolSwitcherLabel('重新打光', false)).toBe(`重新打光 · ${TOOL_SWITCHER_COMING_SOON}`)
    expect(formatToolSwitcherLabel('消除')).toBe('消除')
    expect(formatToolSwitcherLabel('扩图', true)).toBe('扩图')
  })

  it('用同一套 Segmented 选项渲染就绪项和即将上线项', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const onChange = vi.fn()
    await act(async () => {
      root = createRoot(host!)
      root.render(
        <ToolSwitcher
          options={[
            { value: 'remove', label: '消除', ready: true },
            { value: 'relight', label: '重新打光', ready: false },
          ]}
          value="remove"
          onChange={onChange}
        />,
      )
    })
    expect(host.textContent).toContain('消除')
    expect(host.textContent).toContain('重新打光 · 即将上线')
    expect(host.querySelector('.tool-switcher')).not.toBeNull()
    expect(host.querySelector('.ant-segmented')).not.toBeNull()
    expect(host.querySelectorAll('.tool-switcher-fade')).toHaveLength(2)
  })

  it('溢出一侧才显示渐隐，选中项滚入可视区', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const onChange = vi.fn()
    const options = ['智能编辑', '重新打光', '消除', '重绘', '裂变', '融合', '扩图', '精修'].map((label) => ({ value: label, label }))
    await act(async () => {
      root = createRoot(host!)
      root.render(<ToolSwitcher options={options} value="智能编辑" onChange={onChange} />)
    })
    const scroller = host.querySelector('.tool-switcher') as HTMLElement
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 640 })
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 180 })
    Object.defineProperty(scroller, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    await act(async () => { scroller.dispatchEvent(new Event('scroll')) })
    expect(host.querySelector('.tool-switcher-fade.is-right.is-visible')).not.toBeNull()
    expect(host.querySelector('.tool-switcher-fade.is-left.is-visible')).toBeNull()

    scroller.scrollLeft = 200
    await act(async () => { scroller.dispatchEvent(new Event('scroll')) })
    expect(scrollEdges(scroller)).toEqual({ left: true, right: true })
    expect(host.querySelector('.tool-switcher-fade.is-left.is-visible')).not.toBeNull()

    const selected = document.createElement('div')
    Object.defineProperty(selected, 'offsetLeft', { value: 420 })
    Object.defineProperty(selected, 'offsetWidth', { value: 72 })
    scrollSelectedIntoView(scroller, selected)
    expect(scroller.scrollLeft).toBe(420 + 72 + 28 - 180)
  })
})
