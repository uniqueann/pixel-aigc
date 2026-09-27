import { describe, expect, it } from 'vitest'
import { EMPTY_ERASE_MASK_MESSAGE, emptyMaskMessage, remapMaskExportError } from './maskExport'

describe('蒙版导出提示', () => {
  it('按工具给出空蒙版文案', () => {
    expect(emptyMaskMessage('repaint')).toBe('请先涂抹要重绘的区域')
    expect(emptyMaskMessage('remove')).toBe(EMPTY_ERASE_MASK_MESSAGE)
  })

  it('把消除空蒙版错误改写成重绘提示', () => {
    const remapped = remapMaskExportError(new Error(EMPTY_ERASE_MASK_MESSAGE), 'repaint')
    expect(remapped).toBeInstanceOf(Error)
    expect((remapped as Error).message).toBe('请先涂抹要重绘的区域')
    expect(remapMaskExportError(new Error('蒙版画布尚未准备好'), 'repaint').message).toBe('蒙版画布尚未准备好')
  })
})
