import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ ratio: vi.fn(), watermark: vi.fn(), detect: vi.fn(), clear: vi.fn(), remove: vi.fn(), setOwner: vi.fn() }))
vi.mock('@/pages/Toolbox/aspect-ratio/renderer', () => ({ AspectRatioRenderer: class {
  render = mocks.ratio
  dispose = vi.fn()
} }))
vi.mock('@/pages/Toolbox/watermark/renderer', () => ({ WatermarkRenderer: class {
  render = mocks.watermark
  dispose = vi.fn()
} }))
vi.mock('@/pages/Toolbox/aspect-ratio/subjectCache', () => ({ SubjectDetectionCache: class {
  read = mocks.detect
  clear = mocks.clear
  remove = mocks.remove
  setOwner = mocks.setOwner
} }))

import { usePipelineStore } from './store'
import { startPipeline, pausePipeline } from './runtime'
import { useUserStore } from '@/store/useUserStore'

describe('流水线会话执行隔离', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUserStore.getState().setUser('alice', 'free')
    usePipelineStore.getState().reset('alice')
    usePipelineStore.getState().enableWatermark(false)
    usePipelineStore.getState().updateRatio({ background: 'transparent' })
    usePipelineStore.getState().add({ id: 'a', file: new File(['原图'], 'a.png', { type: 'image/png' }), sourceMime: 'image/png', width: 100, height: 80, ratioStatus: 'pending', watermarkStatus: 'pending' })
  })

  it('重复启动只提交一次；暂停后迟到结果不能写回，返回可续跑', async () => {
    let resolve!: (value: { blob: Blob; mimeType: string; width: number; height: number }) => void
    mocks.ratio.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const run = startPipeline()
    await vi.waitFor(() => expect(mocks.ratio).toHaveBeenCalledTimes(1))
    await startPipeline()
    expect(mocks.ratio).toHaveBeenCalledTimes(1)
    pausePipeline()
    expect(usePipelineStore.getState().runState).toBe('paused')
    resolve({ blob: new Blob(['迟到'], { type: 'image/png' }), mimeType: 'image/png', width: 1600, height: 1600 })
    await run
    expect(usePipelineStore.getState().items[0].intermediate).toBeUndefined()
    expect(usePipelineStore.getState().stopping).toBe(false)
    mocks.ratio.mockResolvedValue({ blob: new Blob(['新结果'], { type: 'image/png' }), mimeType: 'image/png', width: 1600, height: 1600 })
    await startPipeline()
    expect(usePipelineStore.getState().items[0].output).toBeDefined()
  })

  it('页面未挂载时用户切换仍清空会话，旧用户结果不能污染新用户', async () => {
    let resolve!: (value: { blob: Blob; mimeType: string; width: number; height: number }) => void
    mocks.ratio.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const run = startPipeline()
    await vi.waitFor(() => expect(mocks.ratio).toHaveBeenCalledTimes(1))
    useUserStore.getState().setUser('bob', 'free')
    expect(usePipelineStore.getState().items).toEqual([])
    expect(mocks.setOwner).toHaveBeenLastCalledWith('bob')
    resolve({ blob: new Blob(['旧用户'], { type: 'image/png' }), mimeType: 'image/png', width: 1600, height: 1600 })
    await run
    expect(usePipelineStore.getState().ownerId).toBe('bob')
    expect(usePipelineStore.getState().items).toEqual([])
    expect(usePipelineStore.getState().stopping).toBe(false)
  })

  it('指定重试跳过普通成功项，仅对降级成功项清除检测缓存重新处理', async () => {
    mocks.ratio.mockResolvedValue({ blob: new Blob(['成品'], { type: 'image/png' }), mimeType: 'image/png', width: 1600, height: 1600 })
    await startPipeline()
    await startPipeline(['a'])
    expect(mocks.ratio).toHaveBeenCalledTimes(1)
    expect(mocks.remove).not.toHaveBeenCalled()
    usePipelineStore.setState(state => ({ items: state.items.map(item => ({ ...item,
      cropFocus: { fx: 0.5, fy: 0.5, source: 'grid', note: '降级裁剪' } })) }))
    await startPipeline(['a'])
    expect(mocks.ratio).toHaveBeenCalledTimes(2)
    expect(mocks.remove).toHaveBeenCalledWith(usePipelineStore.getState().items[0].file)
  })
})
