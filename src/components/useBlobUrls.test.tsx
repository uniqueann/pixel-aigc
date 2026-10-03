// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBlobUrls } from './useBlobUrls'
import { useBlobPreviewGallery } from './useBlobPreviewGallery'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function trackUrls() {
  const alive = new Set<string>()
  let next = 0
  vi.stubGlobal('URL', Object.assign(class extends URL {}, {
    createObjectURL: vi.fn(() => { const url = `blob:测试/${++next}`; alive.add(url); return url }),
    revokeObjectURL: vi.fn((url: string) => alive.delete(url)),
  }))
  return alive
}

describe('共享图片 URL 生命周期', () => {
  it('严格模式只保留当前 Blob 引用，重复渲染不增长，删除和卸载全部回收', () => {
    const alive = trackUrls()
    const a = new Blob(['甲']); const b = new Blob(['乙'])
    const view = renderHook(({ blobs }) => useBlobUrls(blobs), { initialProps: { blobs: [a, a, b] }, wrapper: StrictMode })
    expect(alive.size).toBe(2)
    const first = view.result.current.get(a)
    for (let count = 0; count < 10; count++) view.rerender({ blobs: [a, b, a] })
    expect(alive.size).toBe(2)
    expect(view.result.current.get(a)).toBe(first)
    view.rerender({ blobs: [a] })
    expect(alive.size).toBe(1)
    view.unmount()
    expect(alive.size).toBe(0)
  })

  it('共享预览开关和队列状态变化复用 URL，结果替换后回收旧 URL', () => {
    const alive = trackUrls()
    const file = new File(['原图'], '商品.png')
    const output = new Blob(['结果'])
    const items = [{ id: 'a', file, sourceUrl: 'blob:原图', output }]
    const view = renderHook(({ items }) => useBlobPreviewGallery(items), { initialProps: { items }, wrapper: StrictMode })
    expect(alive.size).toBe(1)
    const first = view.result.current.galleryProps.items[0].fullSrc
    act(() => view.result.current.openAt('a'))
    expect(view.result.current.galleryProps.open).toBe(true)
    view.rerender({ items: [{ ...items[0] }] })
    expect(view.result.current.galleryProps.items[0].fullSrc).toBe(first)
    expect(alive.size).toBe(1)
    view.rerender({ items: [{ ...items[0], output: new Blob(['新结果']) }] })
    expect(alive.size).toBe(1)
    expect(view.result.current.galleryProps.items[0].fullSrc).not.toBe(first)
    view.unmount()
    expect(alive.size).toBe(0)
  })
})
