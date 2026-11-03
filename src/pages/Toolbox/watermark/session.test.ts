import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_WATERMARK_SETTINGS, type BatchImage } from './types'
import { clearWatermarkSession, loadWatermarkSession, saveWatermarkSession } from './session'

afterEach(() => clearWatermarkSession())

function image(overrides: Partial<BatchImage> = {}): BatchImage {
  return {
    id: 'a',
    file: new File(['x'], 'a.png', { type: 'image/png' }),
    sourceMime: 'image/png',
    sourceUrl: 'blob:a',
    width: 10,
    height: 10,
    status: 'succeeded',
    ...overrides,
  }
}

describe('水印会话', () => {
  it('按用户保存并恢复队列、设置与选中项', () => {
    saveWatermarkSession({
      ownerId: 'user-1',
      items: [image()],
      settings: DEFAULT_WATERMARK_SETTINGS,
      selectedId: 'a',
    })
    const saved = loadWatermarkSession('user-1')
    expect(saved?.items).toHaveLength(1)
    expect(saved?.selectedId).toBe('a')
    expect(loadWatermarkSession('user-2')).toBeNull()
  })

  it('离开时把处理中恢复为待处理', () => {
    saveWatermarkSession({
      ownerId: 'local',
      items: [image({ status: 'processing' })],
      settings: DEFAULT_WATERMARK_SETTINGS,
      selectedId: null,
    })
    expect(loadWatermarkSession('local')?.items[0]?.status).toBe('pending')
  })

  it('可以清空会话', () => {
    saveWatermarkSession({ ownerId: 'local', items: [image()], settings: DEFAULT_WATERMARK_SETTINGS, selectedId: 'a' })
    clearWatermarkSession()
    expect(loadWatermarkSession('local')).toBeNull()
  })
})
