import { describe, expect, it } from 'vitest'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import { queueLimitMessage } from './inspect'

describe('选图限额', () => {
  it('超大文件在进入解码前就被拒绝', () => {
    const huge = new File([new Uint8Array(1)], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 })
    const normal = new File([new Uint8Array(1)], 'ok.jpg', { type: 'image/jpeg' })
    Object.defineProperty(normal, 'size', { value: 1024 })
    expect(queueLimitMessage(huge, 0, 0)).toBe('huge.jpg：单张图片不能超过 20 MB')
    expect(queueLimitMessage(normal, 0, 0)).toBeNull()
    expect(queueLimitMessage(normal, 20, 0)).toBe('ok.jpg：一批最多添加 20 张图片')
  })
})

describe('真实抠图是否可开始', () => {
  it('模拟模式可以处理，真实模式只有邮件助手可用', () => {
    expect(liveCapabilityReady(Capability.BgRemove, true)).toBe(true)
    expect(liveCapabilityReady(Capability.BgRemove, false)).toBe(false)
    expect(liveCapabilityReady(Capability.EmailAssist, false)).toBe(true)
  })
})
