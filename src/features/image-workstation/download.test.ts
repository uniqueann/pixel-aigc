import { describe, expect, it } from 'vitest'
import { extensionForMime, filenameForWorkstationResult } from './download'

describe('工作站结果下载命名', () => {
  it('用工具名和真实像素尺寸命名，避免覆盖', () => {
    expect(filenameForWorkstationResult({
      toolLabel: '重绘',
      width: 1280,
      height: 1280,
      mimeType: 'image/jpeg',
    })).toBe('重绘_1280x1280.jpg')
    expect(filenameForWorkstationResult({
      toolLabel: '消除',
      width: 1600,
      height: 1200,
      mimeType: 'image/png',
      index: 2,
    })).toBe('消除_1600x1200_2.png')
  })

  it('从 MIME 推断扩展名', () => {
    expect(extensionForMime('image/webp')).toBe('webp')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime()).toBe('jpg')
  })
})
