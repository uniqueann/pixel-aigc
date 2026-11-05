// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import BrushToolbar from './BrushToolbar'

const baseProps = {
  brushSize: 24,
  tool: 'brush' as const,
  smartSelectEnabled: false,
  smartSelectReady: true,
  canUndo: false,
  canRedo: false,
  onBrushSizeChange: () => undefined,
  onToolChange: () => undefined,
  onSmartSelectToggle: () => undefined,
  onInvert: () => undefined,
  onUndo: () => undefined,
  onRedo: () => undefined,
  onClear: () => undefined,
}

afterEach(cleanup)

describe('涂抹工具条', () => {
  it('常驻显示当前笔刷大小，触控端无需拖动才能看到数值', () => {
    const { rerender } = render(<BrushToolbar {...baseProps} />)
    expect(screen.getByText('24px')).toBeTruthy()
    rerender(<BrushToolbar {...baseProps} brushSize={72} />)
    expect(screen.getByText('72px')).toBeTruthy()
  })

  it('滑块仍以「笔刷大小」暴露给辅助技术', () => {
    render(<BrushToolbar {...baseProps} />)
    expect(screen.getByRole('slider', { name: '笔刷大小' })).toBeTruthy()
  })
})
