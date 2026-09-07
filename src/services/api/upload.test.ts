import { describe, expect, it } from 'vitest'
import { validateImageFile } from './upload'

describe('validateImageFile', () => {
  it('接受受支持的图片类型', () => {
    expect(() => validateImageFile({ type: 'image/png', size: 1024 })).not.toThrow()
  })

  it('拒绝不支持的格式和超大文件', () => {
    expect(() => validateImageFile({ type: 'image/gif', size: 1024 })).toThrow('仅支持 PNG、JPEG 和 WebP 图片')
    expect(() => validateImageFile({ type: 'image/jpeg', size: 21 * 1024 * 1024 })).toThrow('图片大小不能超过 20 MB')
  })
})
