import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ calls: [] as string[], deletes: [] as string[] }))

vi.mock('../db.js', () => ({ runtimeScope: () => 'local' }))
vi.mock('../image-jobs/maintenance.js', () => ({ withImageMaintenance: (action: (sql: unknown) => Promise<unknown>) => action(sql) }))
vi.mock('../storage.js', () => ({ deleteObject: async (key: string) => { state.deletes.push(key) } }))

/** 只记录 SQL 文本并返回固定计数；对象清理队列为空，直接结束循环。 */
const sql = (strings: TemplateStringsArray) => {
  const text = Array.from(strings).join(' ')
  state.calls.push(text)
  if (text.includes('start_expired_suite_cleanup')) return Promise.resolve([{ count: 2 }])
  if (text.includes('cleanup_expired_suite_uploads')) return Promise.resolve([{ count: 3 }])
  return Promise.resolve([])
}

import { cleanupSuiteAssets } from './cleanup.js'

describe('套图维护清理', () => {
  beforeEach(() => {
    state.calls = []
    state.deletes = []
    process.env.ECOMMERCE_SUITE_CLEANUP_ENABLED = 'true'
  })
  afterEach(() => { delete process.env.ECOMMERCE_SUITE_CLEANUP_ENABLED })

  it('清理过期未完成的上传并汇报数量', async () => {
    const report = await cleanupSuiteAssets({ delete: async () => undefined })

    expect(report).toMatchObject({ scope: 'local', projectsStarted: 2, uploadsPurged: 3, objectsDeleted: 0, disabled: false })
    expect(state.calls.some(text => text.includes('cleanup_expired_suite_uploads'))).toBe(true)
  })

  it('开关关闭时不执行任何清理', async () => {
    process.env.ECOMMERCE_SUITE_CLEANUP_ENABLED = 'false'
    const report = await cleanupSuiteAssets({ delete: async () => undefined })

    expect(report.disabled).toBe(true)
    expect(state.calls).toEqual([])
  })
})
