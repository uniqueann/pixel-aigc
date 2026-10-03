import { describe, expect, it, vi } from 'vitest'
import type { RenderRequest as RatioRequest } from '@/pages/Toolbox/aspect-ratio/types'
import type { RenderRequest as WatermarkRequest } from '@/pages/Toolbox/watermark/types'
import { createPipelineStore, defaultPipelineSettings } from './store'
import { executePipeline } from './executor'
import { finalMime, itemStatus, type PipelineItem } from './types'

function image(id: string, sourceMime: PipelineItem['sourceMime'] = 'image/png'): PipelineItem {
  return { id, file: new File([id], `${id}.png`, { type: sourceMime }), sourceMime, width: 100, height: 80,
    ratioStatus: 'pending', watermarkStatus: 'pending' }
}

function setup(images = [image('a')]) {
  const store = createPipelineStore('alice')
  const settings = defaultPipelineSettings()
  settings.aspectRatio.strategy = 'crop'
  settings.watermark.text = '品牌'
  store.getState().initialize(settings)
  images.forEach(item => store.getState().add(item))
  const detect = vi.fn(async () => ({ box: null }))
  const renderRatio = vi.fn(async (request: RatioRequest) => ({ blob: new Blob(['中间图'], { type: request.outputMime }),
    mimeType: request.outputMime!, width: request.targetWidth, height: request.targetHeight }))
  const renderWatermark = vi.fn(async (request: WatermarkRequest) => ({ blob: new Blob(['成品'], { type: request.outputMime }),
    mimeType: request.outputMime!, width: 1600, height: 1600 }))
  const run = (ids?: string[], isStopped = () => false) => executePipeline({
    items: store.getState().items.filter(item => !ids || ids.includes(item.id)), settings: store.getState().settings,
    detect, renderRatio, renderWatermark, isStopped,
    update: (id, patch) => store.setState(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...patch } : item) })),
  })
  return { store, detect, renderRatio, renderWatermark, run }
}

describe('流水线步骤执行与恢复', () => {
  it('顺序串联无损中间图，原图和实际尺寸分别保留', async () => {
    const test = setup([image('透明'), image('照片', 'image/jpeg')])
    await test.run()
    const items = test.store.getState().items
    expect(items.map(itemStatus)).toEqual(['succeeded', 'succeeded'])
    expect(items.map(item => item.output?.mimeType)).toEqual(['image/png', 'image/jpeg'])
    expect(test.renderRatio.mock.calls.map(([request]) => request.outputMime)).toEqual(['image/png', 'image/png'])
    expect(test.renderWatermark.mock.calls[0][0].file.type).toBe('image/png')
    expect(items[0].intermediate?.width).toBe(1600)
    expect(items[0].width).toBe(100)
    expect(await test.renderWatermark.mock.calls[0][0].file.text()).toBe('中间图')
  })

  it('水印失败不阻断下一张，重试只执行水印且跳过成功项', async () => {
    const test = setup([image('a'), image('b')])
    test.renderWatermark.mockRejectedValueOnce(new Error('编码失败'))
    await test.run()
    expect(test.store.getState().items.map(itemStatus)).toEqual(['failed', 'succeeded'])
    expect(test.store.getState().items[0].intermediate).toBeDefined()
    await test.run()
    expect(test.store.getState().items.map(itemStatus)).toEqual(['succeeded', 'succeeded'])
    expect(test.renderRatio).toHaveBeenCalledTimes(2)
    expect(test.detect).toHaveBeenCalledTimes(2)
    expect(test.renderWatermark).toHaveBeenCalledTimes(3)
  })

  it('修改水印复用中间图，修改转比例从原图重新处理', async () => {
    const test = setup()
    await test.run()
    const source = test.store.getState().items[0].file
    const intermediate = test.store.getState().items[0].intermediate
    test.store.getState().updateWatermark({ text: '新品牌' })
    expect(test.store.getState().items[0].intermediate).toBe(intermediate)
    await test.run()
    expect(test.detect).toHaveBeenCalledTimes(1)
    expect(test.renderRatio).toHaveBeenCalledTimes(1)
    expect(test.renderWatermark).toHaveBeenCalledTimes(2)
    test.store.getState().updateRatio({ fx: 0 })
    expect(test.store.getState().items[0].intermediate).toBeUndefined()
    await test.run()
    expect(test.renderRatio.mock.calls[1][0].file).toBe(source)
  })

  it('尺寸或中间格式错误只使转比例步骤失败', async () => {
    const test = setup([image('a'), image('b')])
    test.renderRatio.mockResolvedValueOnce({ blob: new Blob(['错误'], { type: 'image/png' }), mimeType: 'image/png', width: 10, height: 10 })
    await test.run()
    expect(test.store.getState().items[0].failedStep).toBe('ratio')
    expect(test.renderWatermark).toHaveBeenCalledTimes(1)
    await test.run(['a'])
    expect(test.store.getState().items.map(itemStatus)).toEqual(['succeeded', 'succeeded'])
  })

  it('无水印内容时在任何处理调用之前阻止启动', async () => {
    const test = setup()
    test.store.getState().updateWatermark({ text: '  ' })
    await expect(test.run()).rejects.toThrow('请先填写水印')
    expect(test.detect).not.toHaveBeenCalled()
    expect(test.renderRatio).not.toHaveBeenCalled()
  })

  it('水印关闭时 PNG 复用中间图，JPEG 仅执行最终编码', async () => {
    const test = setup([image('透明'), image('照片', 'image/jpeg')])
    test.store.getState().enableWatermark(false)
    await test.run()
    const items = test.store.getState().items
    expect(items[0].output).toBe(items[0].intermediate)
    expect(items.map(item => item.watermarkStatus)).toEqual(['skipped', 'skipped'])
    expect(test.renderWatermark).toHaveBeenCalledTimes(1)
    expect(test.renderWatermark.mock.calls[0][0].settings.text).toBe('')
    expect(test.renderWatermark.mock.calls[0][0].settings.logo).toBeNull()
  })

  it('检测超时降级后继续并保留提示，主动取消不降级', async () => {
    const test = setup()
    test.detect.mockRejectedValueOnce(new DOMException('检测超时', 'TimeoutError'))
    await test.run()
    expect(test.store.getState().items[0].cropFocus?.note).toContain('主体检测失败')
    expect(itemStatus(test.store.getState().items[0])).toBe('succeeded')
    const cancelled = setup()
    let stopped = false
    cancelled.detect.mockImplementationOnce(async () => { stopped = true; throw new DOMException('已取消', 'AbortError') })
    await cancelled.run(undefined, () => stopped)
    expect(cancelled.renderRatio).not.toHaveBeenCalled()
    expect(cancelled.store.getState().items[0].cropFocus).toBeUndefined()
  })

  it('转比例提交成功后暂停，续跑从水印开始', async () => {
    const test = setup()
    let stopped = false
    test.renderWatermark.mockImplementationOnce(async request => {
      stopped = true
      return { blob: new Blob(['迟到'], { type: request.outputMime }), mimeType: request.outputMime!, width: 1600, height: 1600 }
    })
    await test.run(undefined, () => stopped)
    expect(test.store.getState().items[0].intermediate).toBeDefined()
    expect(test.store.getState().items[0].output).toBeUndefined()
    await test.run()
    expect(test.renderRatio).toHaveBeenCalledTimes(1)
    expect(itemStatus(test.store.getState().items[0])).toBe('succeeded')
  })

  it('运行期间锁定参数，用户切换清空所有图片与配置', async () => {
    const test = setup()
    test.store.setState({ runState: 'running' })
    test.store.getState().updateWatermark({ text: '不能改变' })
    expect(test.store.getState().settings.watermark.text).toBe('品牌')
    test.store.getState().reset('bob')
    expect(test.store.getState().items).toEqual([])
    expect(test.store.getState().settings.watermark.text).toBe('')
    expect(test.store.getState().ownerId).toBe('bob')
  })

  it('所有格式分支依据背景策略与原始 MIME，而非中间 PNG', () => {
    const settings = defaultPipelineSettings()
    expect(finalMime(image('a'), settings)).toBe('image/jpeg')
    settings.aspectRatio.background = 'transparent'
    expect(finalMime(image('a', 'image/jpeg'), settings)).toBe('image/png')
    settings.aspectRatio.strategy = 'crop'
    expect(finalMime(image('a', 'image/webp'), settings)).toBe('image/png')
    expect(finalMime(image('a', 'image/jpeg'), settings)).toBe('image/jpeg')
  })
})
