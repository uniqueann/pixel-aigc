import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_ASPECT_RATIO_SETTINGS, type BatchImage } from './types'
import { clearAspectRatioSession, loadAspectRatioSession, saveAspectRatioSession } from './session'

afterEach(() => clearAspectRatioSession())

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

describe('转比例会话', () => {
  it('按用户保存并恢复队列、设置与选中项', () => {
    saveAspectRatioSession({
      ownerId: 'user-1',
      items: [image()],
      settings: DEFAULT_ASPECT_RATIO_SETTINGS,
      selectedId: 'a',
    })
    const saved = loadAspectRatioSession('user-1')
    expect(saved?.items).toHaveLength(1)
    expect(saved?.settings).toEqual(DEFAULT_ASPECT_RATIO_SETTINGS)
    expect(saved?.selectedId).toBe('a')
    expect(loadAspectRatioSession('user-2')).toBeNull()
  })

  it('离开时把处理中恢复为待处理', () => {
    saveAspectRatioSession({
      ownerId: 'local',
      items: [image({ status: 'processing' })],
      settings: DEFAULT_ASPECT_RATIO_SETTINGS,
      selectedId: null,
    })
    expect(loadAspectRatioSession('local')?.items[0]?.status).toBe('pending')
  })

  it('保留已完成结果与输出', () => {
    const output = new Blob(['result'], { type: 'image/png' })
    saveAspectRatioSession({
      ownerId: 'local',
      items: [image({ output, outputMime: 'image/png' })],
      settings: DEFAULT_ASPECT_RATIO_SETTINGS,
      selectedId: 'a',
    })
    expect(loadAspectRatioSession('local')?.items[0]?.output).toBe(output)
  })

  it('可以清空会话', () => {
    saveAspectRatioSession({ ownerId: 'local', items: [image()], settings: DEFAULT_ASPECT_RATIO_SETTINGS, selectedId: 'a' })
    clearAspectRatioSession()
    expect(loadAspectRatioSession('local')).toBeNull()
  })
})
