import { describe, expect, it } from 'vitest'
import { inspectSuiteImage } from './assets.js'
import { MOCK_PNG_1X1 } from '../image-providers/mock.js'
import sharp from 'sharp'
describe('套图图片实体验证', () => {
  it('校验实际内容、尺寸和哈希，不接受声明为其他格式', async () => {
    expect(await inspectSuiteImage(MOCK_PNG_1X1, 'image/png')).toMatchObject({ size: { width: 1, height: 1 }, mimeType: 'image/png', bytes: MOCK_PNG_1X1.length })
    await expect(inspectSuiteImage(MOCK_PNG_1X1, 'image/jpeg')).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    await expect(inspectSuiteImage(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    await expect(inspectSuiteImage(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 })
  })
  it('按 EXIF 校正后的显示方向登记尺寸，避免手机照片比例颠倒', async () => {
    const jpeg = await sharp({ create: { width: 80, height: 50, channels: 3, background: '#fff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    expect((await inspectSuiteImage(jpeg, 'image/jpeg')).size).toEqual({ width: 50, height: 80 })
  })
})
