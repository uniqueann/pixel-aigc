// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import {
  clearWorkstationHistory,
  deleteWorkstationHistory,
  listWorkstationHistory,
  recordWorkstationHistory,
} from './workstationHistory'

function record(id: string, createdAt: string) {
  return {
    id,
    toolSlug: 'repaint' as const,
    capability: Capability.Inpaint,
    prompt: '一盆小型绿色盆栽',
    width: 1280,
    height: 1280,
    mimeType: 'image/jpeg',
    result: new Blob([id], { type: 'image/jpeg' }),
    createdAt,
    updatedAt: createdAt,
  }
}

describe('工作站本地历史', () => {
  beforeEach(async () => {
    await clearWorkstationHistory()
  })

  it('写入成功结果后可按时间倒序读出', async () => {
    await recordWorkstationHistory(record('older', '2026-09-27T12:00:00.000Z'))
    await recordWorkstationHistory(record('newer', '2026-09-27T13:00:00.000Z'))
    const items = await listWorkstationHistory()
    expect(items.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(items[0].result.size).toBe('newer'.length)
    expect(items[0].mimeType).toBe('image/jpeg')
  })

  it('可删除单条记录', async () => {
    await recordWorkstationHistory(record('keep', '2026-09-27T12:00:00.000Z'))
    await recordWorkstationHistory(record('drop', '2026-09-27T13:00:00.000Z'))
    await deleteWorkstationHistory('drop')
    expect((await listWorkstationHistory()).map((item) => item.id)).toEqual(['keep'])
  })
})
