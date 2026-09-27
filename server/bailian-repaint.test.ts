import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { compositeRepaint, fitRepaintSize, repaintWithBailian } from './bailian-repaint'
import { HttpError } from './errors'

async function solid(width: number, height: number, color: { r: number; g: number; b: number }, format: 'png' | 'jpeg' = 'png') {
  const image = sharp({ create: { width, height, channels: 3, background: color } })
  return format === 'jpeg' ? image.jpeg().toBuffer() : image.png().toBuffer()
}

async function halfMask(width: number, height: number) {
  const raw = Buffer.alloc(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < Math.floor(width / 2); x += 1) raw[y * width + x] = 255
  }
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer()
}

describe('重绘尺寸', () => {
  it('短边不足 512 时放大，长边超过 4096 时缩小', () => {
    expect(fitRepaintSize(400, 300).height).toBeGreaterThanOrEqual(512)
    expect(Math.max(fitRepaintSize(8000, 6000).width, fitRepaintSize(8000, 6000).height)).toBeLessThanOrEqual(4096)
  })

  it('宽高比超出范围时拒绝', () => {
    expect(() => fitRepaintSize(100, 4000)).toThrow(/宽高比/)
  })
})

describe('重绘合成', () => {
  it('白区使用模型像素，黑区保持原图', async () => {
    const original = await solid(32, 16, { r: 10, g: 20, b: 200 })
    const model = await solid(32, 16, { r: 220, g: 30, b: 40 }, 'jpeg')
    const mask = await halfMask(32, 16)
    const output = await compositeRepaint(original, model, mask)
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(32)
    expect(info.height).toBe(16)
    const left = data[0]
    const rightIndex = (Math.floor(info.width * 0.75) + info.width * 4) * info.channels
    expect(left).toBeGreaterThan(180)
    expect(data[rightIndex]).toBeLessThan(40)
    expect(data[rightIndex + 2]).toBeGreaterThan(160)
  })
})

describe('百炼局部重绘', () => {
  it('只传局部重绘参数，结果宽高等于原图', async () => {
    const source = await solid(640, 480, { r: 10, g: 20, b: 200 }, 'jpeg')
    const mask = await halfMask(640, 480)
    const model = await solid(640, 480, { r: 220, g: 30, b: 40 }, 'jpeg')
    const calls: Array<{ url: string; body?: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? String(init.body) : undefined })
      if (url.endsWith('/image-synthesis')) {
        return new Response(JSON.stringify({ output: { task_id: 'task-1', task_status: 'PENDING' } }), { status: 200 })
      }
      if (url.endsWith('/tasks/task-1')) {
        return new Response(JSON.stringify({
          output: { task_id: 'task-1', task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/repaint.jpg' }] },
        }), { status: 200 })
      }
      return new Response(model, { status: 200 })
    }
    const output = await repaintWithBailian(source, mask, '  桌面上的透明玻璃花瓶  ', {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    const body = JSON.parse(calls[0].body ?? '{}') as {
      model: string
      input: { function: string; prompt: string; mask_image_url: string }
      parameters: Record<string, unknown>
    }
    expect(body.model).toBe('wanx2.1-imageedit')
    expect(body.input.function).toBe('description_edit_with_mask')
    expect(body.input.prompt).toBe('桌面上的透明玻璃花瓶')
    expect(body.input.mask_image_url.startsWith('data:image/png;base64,')).toBe(true)
    expect(body.parameters).toEqual({ n: 1, watermark: false })
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(480)
    expect(meta.format).toBe('jpeg')
  })

  it('没有涂抹时不创建任务', async () => {
    const source = await solid(640, 480, { r: 1, g: 2, b: 3 }, 'jpeg')
    const mask = await solid(640, 480, { r: 0, g: 0, b: 0 })
    const fetchImpl = () => Promise.reject(new Error('不应请求'))
    await expect(repaintWithBailian(source, mask, '一只杯子', {
      fetch: fetchImpl as typeof fetch,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
    })).rejects.toMatchObject({ message: '请先涂抹要重绘的区域', status: 400 })
  })

  it('没有配置时不发起请求', async () => {
    await expect(repaintWithBailian(Buffer.from('jpeg'), Buffer.from('png'), '杯子', { env: {} }))
      .rejects.toBeInstanceOf(HttpError)
  })
})
