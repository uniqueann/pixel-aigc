import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { probeVideo } from './metadata.js'

describe('视频真实元数据解析', () => {
  it.each([5, 10])('从现有 %i 秒 MP4 读取真实尺寸、时长和编码', seconds => {
    const bytes = readFileSync(`public/mock/text-to-video-${seconds}s.mp4`)
    expect(probeVideo(bytes)).toMatchObject({ width: 640, height: 360, durationSeconds: seconds, sizeBytes: bytes.length, hasAudio: false,
      videoCodec: expect.stringMatching(/^avc1\./) })
  })
  it('拒绝伪造后缀和截断文件', () => {
    expect(() => probeVideo(Buffer.from('这不是视频'))).toThrow()
    expect(() => probeVideo(readFileSync('public/mock/text-to-video-5s.mp4').subarray(0, 32))).toThrow()
  })
})
