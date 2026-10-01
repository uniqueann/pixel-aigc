// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { retainImageBlob, runtimeImageBlob } from './imageRuntime'
afterEach(() => vi.restoreAllMocks())
describe('图片展示地址租约', () => {
  it('多个视图共享地址，最后一个视图释放后才撤销', () => {
    URL.createObjectURL = vi.fn(() => 'blob:shared')
    URL.revokeObjectURL = vi.fn()
    const blob = new Blob(['图片'])
    const first = retainImageBlob(blob), second = retainImageBlob(blob)
    expect(first.url).toBe(second.url)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    first.release(); first.release()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(runtimeImageBlob(second.url)).toBe(blob)
    second.release()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:shared')
    expect(runtimeImageBlob(second.url)).toBeUndefined()
  })
})
