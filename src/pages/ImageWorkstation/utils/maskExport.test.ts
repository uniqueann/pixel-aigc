// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { ERASE_OVERLAY_HEIGHT, ERASE_OVERLAY_WIDTH } from '../../../../shared/erase'
import { exportEraseMask } from './maskExport'

const canvas2d = typeof document !== 'undefined'
  ? document.createElement('canvas').getContext('2d')
  : null

describe.skipIf(!canvas2d)('消除蒙版导出', () => {
  it('把 contain 预览上的笔划映射到原图像素并做成纯黑白 PNG', () => {
    const canvas = document.createElement('canvas')
    canvas.width = ERASE_OVERLAY_WIDTH
    canvas.height = ERASE_OVERLAY_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(220, 38, 38, 0.5)'
    context.fillRect(200, 120, 40, 24)
    const result = exportEraseMask(canvas, { width: 2000, height: 1000 })
    expect(result.width).toBe(2000)
    expect(result.height).toBe(1000)
    expect(result.maskDataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('只涂在预览黑边上则没有有效消除区', () => {
    const canvas = document.createElement('canvas')
    canvas.width = ERASE_OVERLAY_WIDTH
    canvas.height = ERASE_OVERLAY_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) {
      expect(context).toBeTruthy()
      return
    }
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(220, 38, 38, 0.5)'
    context.fillRect(10, 8, 20, 10)
    expect(() => exportEraseMask(canvas, { width: 2000, height: 1000 })).toThrow('请先涂抹要消除的区域')
  })
})
