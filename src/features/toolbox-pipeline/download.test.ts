import { describe, expect, it, vi } from 'vitest'
const zip = vi.hoisted(() => vi.fn(async (files: { name: string; blob: Blob }[]) => new Blob([`压缩包 ${files.length}`])))
vi.mock('@/pages/Toolbox/shared/zip', () => ({ createResultZip: zip }))
import { pipelineNames, createPipelineZip } from './download'
import { defaultPipelineSettings } from './store'
import type { PipelineItem } from './types'

function item(id: string, mimeType: 'image/png' | 'image/jpeg', name = '商品.png'): PipelineItem {
  return { id, file: new File(['原图'], name), sourceMime: 'image/png', width: 100, height: 80,
    ratioStatus: 'succeeded', watermarkStatus: 'succeeded', output: { blob: new Blob(['成品'], { type: mimeType }), mimeType, width: 1600, height: 1600 } }
}

describe('流水线导出', () => {
  it('根据实际格式命名，保留平台和水印后缀并处理重名', () => {
    const settings = defaultPipelineSettings()
    const names = [...pipelineNames([item('a', 'image/png'), item('b', 'image/png'), item('c', 'image/jpeg')], settings).values()]
    expect(names[0]).toBe('商品_amazon-main_watermarked.png')
    expect(new Set(names).size).toBe(3)
    expect(names[2]).toMatch(/\.jpg$/)
    settings.watermarkEnabled = false
    expect([...pipelineNames([item('a', 'image/jpeg', '../商品.webp')], settings).values()][0]).toBe('.._商品_amazon-main.jpg')
  })
  it('ZIP 只收录成功成品，打包失败仍保留结果供再次下载', async () => {
    const settings = defaultPipelineSettings()
    const success = item('a', 'image/png')
    const failure = { ...item('b', 'image/png'), watermarkStatus: 'failed' as const, output: undefined }
    await createPipelineZip([success, failure], settings)
    expect(zip.mock.calls[0][0]).toHaveLength(1)
    zip.mockRejectedValueOnce(new Error('结果超过 200 MB'))
    await expect(createPipelineZip([success], settings)).rejects.toThrow('200 MB')
    expect(success.output).toBeDefined()
  })
})
