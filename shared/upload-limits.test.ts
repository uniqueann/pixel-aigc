import { describe, expect, it } from 'vitest'
import {
  base64FitsPlatform, base64Length, formatMegabytes,
  IMAGE_TOO_LARGE_MESSAGE, JSON_BODY_OVERHEAD_BYTES, MAX_IMAGE_BYTES, PLATFORM_BODY_BYTES, REQUEST_TOO_LARGE_MESSAGE, uploadFailureText,
} from './upload-limits'

describe('上传体积预算', () => {
  it('base64 长度为 4/3 向上取整', () => {
    expect(base64Length(0)).toBe(0)
    expect(base64Length(1)).toBe(4)
    expect(base64Length(3)).toBe(4)
    expect(base64Length(4)).toBe(8)
  })

  it('只有 base64 后仍装进平台请求体才允许回退', () => {
    // 3 MB 原图 → 4 MB base64，加上 64 KB 开销仍在 4.5 MB 内。
    expect(base64FitsPlatform(3 * 1024 * 1024)).toBe(true)
    // 4 MB 原图 → 5.33 MB base64，必然被平台拒掉。
    expect(base64FitsPlatform(4 * 1024 * 1024)).toBe(false)
  })

  it('业务上限与平台上限分开，业务可远大于平台', () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024)
    expect(PLATFORM_BODY_BYTES).toBe(4_500_000)
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(PLATFORM_BODY_BYTES)
    expect(JSON_BODY_OVERHEAD_BYTES).toBeLessThan(PLATFORM_BODY_BYTES)
  })

  it('超限文案给出具体上限', () => {
    expect(IMAGE_TOO_LARGE_MESSAGE).toBe('图片大小不能超过 20 MB')
    expect(formatMegabytes(MAX_IMAGE_BYTES)).toBe('20 MB')
    expect(formatMegabytes(1536 * 1024)).toBe('1.5 MB')
  })

  it('平台英文 413 换为可操作中文结论', () => {
    expect(uploadFailureText('Request failed with status code 413')).toBe(REQUEST_TOO_LARGE_MESSAGE)
    expect(uploadFailureText('Request Entity Too Large')).toBe(REQUEST_TOO_LARGE_MESSAGE)
    expect(uploadFailureText('Payload Too Large')).toBe(REQUEST_TOO_LARGE_MESSAGE)
    expect(uploadFailureText(undefined, 413)).toBe(REQUEST_TOO_LARGE_MESSAGE)
  })

  it('服务端已有的中文文案与其它状态保持原样', () => {
    expect(uploadFailureText('请求内容过大', 413)).toBe('请求内容过大')
    expect(uploadFailureText('积分不足', 402)).toBe('积分不足')
    expect(uploadFailureText('原图对象无效', 400)).toBe('原图对象无效')
    expect(uploadFailureText(undefined, 500)).toBeUndefined()
    expect(uploadFailureText('   ', 400)).toBeUndefined()
  })
})
