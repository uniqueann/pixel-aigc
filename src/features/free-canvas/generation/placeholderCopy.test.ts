import { describe, expect, it } from 'vitest'
import type { GenerationJob } from '@/editor/types'
import { Capability } from '@/types'
import { formatElapsed, placeholderDetail } from './placeholderCopy'

const START = Date.parse('2026-01-01T00:00:00Z')

function job(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'gen-1', capability: Capability.TextToImage, status: 'processing',
    input: {}, inputAssetIds: [], outputAssetIds: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('生成占位文案', () => {
  it('时长按秒/分秒显示', () => {
    expect(formatElapsed(0)).toBe('0 秒')
    expect(formatElapsed(12_400)).toBe('12 秒')
    expect(formatElapsed(59_600)).toBe('1 分')
    expect(formatElapsed(125_000)).toBe('2 分 5 秒')
    expect(formatElapsed(-500)).toBe('0 秒')
  })

  it('生成中显示已用时长', () => {
    expect(placeholderDetail('processing', job(), START + 12_000)).toBe('已用 12 秒 · 完成后替换此占位')
    expect(placeholderDetail('processing', job(), START + 95_000)).toBe('已用 1 分 35 秒 · 完成后替换此占位')
  })

  it('排队中显示已等待时长', () => {
    expect(placeholderDetail('queued', job({ status: 'queued' }), START + 8_000)).toBe('已等待 8 秒')
    expect(placeholderDetail('pending', job({ status: 'pending' }), START + 3_000)).toBe('已等待 3 秒')
  })

  it('失败态给下一步操作，不再报时长', () => {
    expect(placeholderDetail('failed', job({ status: 'failed' }), START + 60_000)).toBe('可在右侧重试或修改参数')
    expect(placeholderDetail('cancelled', job({ status: 'cancelled' }), START + 60_000)).toBe('可在右侧重试或修改参数')
  })

  it('任务还没登记或状态未知时给中性文案', () => {
    expect(placeholderDetail(undefined, undefined)).toBe('正在等待生成任务')
    expect(placeholderDetail('processing', undefined)).toBe('结果完成后会替换此占位')
  })
})
