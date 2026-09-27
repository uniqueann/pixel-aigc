import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { fitDashScopeImageSize } from '../shared/erase'
import { DEFAULT_ERASE_PROMPT } from '../shared/erase'
import { dashScopeFailureText } from './dashscope'
import { ERASE_MASK_DATA_URL_PREFIX, ERASE_WAIT_TIMEOUT_MESSAGE, eraseWithBailian, prepareEraseMask, restoreEraseResult } from './bailian-erase'
import { HttpError } from './errors'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function solidJpeg(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer()
}

async function maskPng(width: number, height: number, paint: (pixels: Uint8Array) => void) {
  const pixels = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4 + 3] = 255
  }
  paint(pixels)
  return sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } }).png().toBuffer()
}

describe('消除蒙版预处理', () => {
  it('灰边阈值后膨胀，输出与目标同尺寸的纯黑白 PNG', async () => {
    const source = await maskPng(8, 8, (pixels) => {
      pixels[(3 * 8 + 3) * 4] = 180
      pixels[(3 * 8 + 3) * 4 + 1] = 180
      pixels[(3 * 8 + 3) * 4 + 2] = 180
    })
    const prepared = await prepareEraseMask(source, 8, 8, 1)
    expect(prepared.width).toBe(8)
    expect(prepared.height).toBe(8)
    const meta = await sharp(prepared.png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.channels).toBe(1)
    expect(prepared.png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    const raw = await sharp(prepared.png).raw().toBuffer({ resolveWithObject: true })
    expect(raw.info.width).toBe(8)
    expect(raw.info.height).toBe(8)
    expect(raw.info.channels).toBe(1)
    for (let i = 0; i < raw.info.width * raw.info.height; i += 1) {
      const value = raw.data[i * raw.info.channels]
      expect(value === 0 || value === 255).toBe(true)
    }
    expect(raw.data[(3 * 8 + 3) * raw.info.channels]).toBe(255)
    expect(raw.data[(3 * 8 + 2) * raw.info.channels]).toBe(255)
  })

  it('蒙版与底图不同尺寸时按同一几何缩放到送模尺寸', async () => {
    const source = await maskPng(400, 300, (pixels) => {
      pixels[(10 * 400 + 20) * 4] = 255
      pixels[(10 * 400 + 20) * 4 + 1] = 255
      pixels[(10 * 400 + 20) * 4 + 2] = 255
    })
    const fitted = fitDashScopeImageSize(400, 300)
    const prepared = await prepareEraseMask(source, fitted.width, fitted.height, 0)
    expect(prepared.width).toBe(fitted.width)
    expect(prepared.height).toBe(fitted.height)
    expect(prepared.sourceWidth).toBe(400)
    expect(prepared.sourceHeight).toBe(300)
  })

  it('全黑蒙版拒绝提交', async () => {
    const source = await maskPng(16, 16, () => {})
    await expect(prepareEraseMask(source, 16, 16, 0)).rejects.toMatchObject({
      status: 400,
      code: 'EMPTY_MASK',
    })
  })
})

describe('消除结果尺寸还原', () => {
  it('模型输出尺寸不同则拉回原图宽高', async () => {
    const model = await solidJpeg(800, 600, { r: 9, g: 8, b: 7 })
    const restored = await restoreEraseResult(model, 1600, 1200)
    expect(restored.resized).toBe(true)
    expect(restored.modelWidth).toBe(800)
    expect(restored.modelHeight).toBe(600)
    const meta = await sharp(restored.output).metadata()
    expect(meta.width).toBe(1600)
    expect(meta.height).toBe(1200)
    expect(meta.format).toBe('jpeg')
  })

  it('尺寸已一致且是 JPEG 时不改像素缓冲', async () => {
    const model = await solidJpeg(640, 480, { r: 1, g: 2, b: 3 })
    const restored = await restoreEraseResult(model, 640, 480)
    expect(restored.resized).toBe(false)
    expect(restored.output).toBe(model)
  })
})

describe('万相消除调用', () => {
  it('提交 wanx2.1-imageedit description_edit_with_mask，蒙版与底图同尺寸，n=1', async () => {
    const source = await solidJpeg(640, 640, { r: 10, g: 20, b: 30 })
    const mask = await maskPng(640, 640, (pixels) => {
      for (let y = 20; y < 40; y += 1) {
        for (let x = 20; x < 40; x += 1) {
          const offset = (y * 640 + x) * 4
          pixels[offset] = 255
          pixels[offset + 1] = 255
          pixels[offset + 2] = 255
        }
      }
    })
    const model = await solidJpeg(1024, 1024, { r: 200, g: 10, b: 10 })
    const calls: Array<{ url: string; body?: string }> = []
    const logs: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? String(init.body) : undefined })
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'erase-1', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/erase-1')) {
        return jsonResponse({
          output: { task_id: 'erase-1', task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/erase.jpg' }] },
        })
      }
      return new Response(model, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    }
    const output = await eraseWithBailian(source, mask, '', {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
      log: entry => { logs.push(entry) },
    })
    const body = JSON.parse(calls[0].body ?? '{}') as {
      model: string
      input: { function: string; prompt: string; base_image_url: string; mask_image_url: string }
      parameters: Record<string, unknown>
    }
    expect(calls[0].url).toContain('/api/v1/services/aigc/image2image/image-synthesis')
    expect(body.model).toBe('wanx2.1-imageedit')
    expect(body.input.function).toBe('description_edit_with_mask')
    expect(body.input.prompt).toBe(DEFAULT_ERASE_PROMPT)
    expect(body.input.prompt.length).toBeGreaterThan(0)
    expect(body.input.base_image_url.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(body.input.mask_image_url.startsWith(ERASE_MASK_DATA_URL_PREFIX)).toBe(true)
    const maskBytes = Buffer.from(body.input.mask_image_url.slice(ERASE_MASK_DATA_URL_PREFIX.length), 'base64')
    const maskMeta = await sharp(maskBytes).metadata()
    expect(maskMeta.format).toBe('png')
    expect(maskMeta.width).toBe(640)
    expect(maskMeta.height).toBe(640)
    expect(maskMeta.channels).toBe(1)
    expect(body.parameters).toEqual({ n: 1, watermark: false })
    expect(logs.find(entry => entry.stage === 'plan')).toMatchObject({
      promptChars: DEFAULT_ERASE_PROMPT.length, promptDefaulted: true,
    })
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(640)
    expect(logs.find(entry => entry.stage === 'restore')).toMatchObject({
      inputWidth: 640, inputHeight: 640, modelWidth: 1024, modelHeight: 1024, resized: true,
    })
  })

  it('大物体可带背景描述，有内容时保留用户原文', async () => {
    const source = await solidJpeg(640, 640, { r: 11, g: 11, b: 11 })
    const mask = await maskPng(640, 640, (pixels) => {
      pixels[0] = 255
      pixels[1] = 255
      pixels[2] = 255
    })
    const model = await solidJpeg(640, 640, { r: 12, g: 12, b: 12 })
    let prompt = 'unset'
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        prompt = (JSON.parse(String(init?.body ?? '{}')) as { input: { prompt: string } }).input.prompt
        return jsonResponse({ output: { task_id: 'erase-2', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/erase-2')) {
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] } })
      }
      return new Response(model, { status: 200 })
    }
    await eraseWithBailian(source, mask, '  浅色木桌和白色墙面  ', {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    expect(prompt).toBe('浅色木桌和白色墙面')
  })

  it('任务 FAILED 时记下 code/message，并把 string index 译成中文', async () => {
    const source = await solidJpeg(640, 640, { r: 1, g: 1, b: 1 })
    const mask = await maskPng(640, 640, (pixels) => {
      pixels[0] = 255
      pixels[1] = 255
      pixels[2] = 255
    })
    const logs: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'erase-fail', task_status: 'PENDING' } })
      }
      return jsonResponse({
        output: {
          task_id: 'erase-fail',
          task_status: 'FAILED',
          code: 'InvalidParameter',
          message: 'string index out of range',
        },
      })
    }
    await expect(eraseWithBailian(source, mask, '', {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
      log: entry => { logs.push(entry) },
    })).rejects.toMatchObject({
      status: 502,
      code: 'ERASE_FAILED',
      message: '消除服务没有读到有效参数，请重新涂抹后重试',
    })
    expect(logs.find(entry => entry.stage === 'poll' && entry.status === 'FAILED')).toMatchObject({
      taskId: 'erase-fail',
      code: 'InvalidParameter',
      message: 'string index out of range',
    })
  })

  it('轮询一直 RUNNING 直到截止则 504，日志带 taskId', async () => {
    const source = await solidJpeg(640, 640, { r: 1, g: 1, b: 1 })
    const mask = await maskPng(640, 640, (pixels) => {
      pixels[0] = 255
      pixels[1] = 255
      pixels[2] = 255
    })
    let now = 0
    const logs: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'erase-slow', task_status: 'PENDING' } })
      }
      return jsonResponse({ output: { task_id: 'erase-slow', task_status: 'RUNNING' } })
    }
    await expect(eraseWithBailian(source, mask, '', {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async (ms) => { now += ms },
      now: () => now,
      deadlineMs: 1_200,
      log: entry => { logs.push(entry) },
    })).rejects.toMatchObject({
      status: 504,
      message: ERASE_WAIT_TIMEOUT_MESSAGE,
      code: 'ERASE_TIMEOUT',
    })
    expect(logs.find(entry => entry.stage === 'wait')).toMatchObject({ done: false, taskId: 'erase-slow' })
  })

  it('未配置 Key 时 503，不发请求', async () => {
    const source = await solidJpeg(640, 640, { r: 1, g: 1, b: 1 })
    const mask = await maskPng(640, 640, (pixels) => {
      pixels[0] = 255
      pixels[1] = 255
      pixels[2] = 255
    })
    const fetchImpl = async () => {
      throw new Error('should not fetch')
    }
    await expect(eraseWithBailian(source, mask, '', {
      fetch: fetchImpl as typeof fetch,
      env: {},
    })).rejects.toBeInstanceOf(HttpError)
    await expect(eraseWithBailian(source, mask, '', {
      fetch: fetchImpl as typeof fetch,
      env: {},
    })).rejects.toMatchObject({ status: 503, code: 'ERASE_UNAVAILABLE' })
  })
})
