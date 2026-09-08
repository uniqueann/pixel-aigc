// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, it, expect, afterEach } from 'vitest'
import { readCurrentSnapshot, readLegacySnapshot, setPersistenceUser, writeCurrentSnapshot } from '@/editor/persistence/database'
import { parseSnapshot, persistableSnapshot } from '@/editor/persistence/snapshot'
import { defaultDrafts, type ProjectSnapshot } from '@/editor/persistence/types'
const snapshot: ProjectSnapshot = { schemaVersion: 1, cloud: { revision: 2, pending: true }, drafts: defaultDrafts(), recoveries: {}, project: {
  id: 'p', name: '测试', createdAt: '2026-01-01', updatedAt: '2026-01-01', generations: {}, document: { version: 1, activeSceneId: 's', scenes: [{ id: 's', name: '场景', width: 100, height: 100, viewport: { zoom: 1, panX: 0, panY: 0 }, nodes: [] }] },
  assets: { a: { id: 'a', name: '图', type: 'image', source: 'upload', createdAt: '2026-01-01', width: 100, height: 100, mimeType: 'image/png', url: 'https://r2.example/a?X-Amz-Signature=SECRET', storage: { provider: 'r2', objectKey: 'media/key', projectId: 'p' }, accessExpiresAt: 100 } },
} }
afterEach(() => { setPersistenceUser('test-reset') })
describe('账号分区与稳定素材引用', () => {
  it('两个账号的当前项目不会互相覆盖，旧匿名项目不自动认领', async () => {
    setPersistenceUser('alice')
    await writeCurrentSnapshot(snapshot)
    setPersistenceUser('bob')
    expect(await readCurrentSnapshot()).toBeUndefined()
    await writeCurrentSnapshot({ ...snapshot, project: { ...snapshot.project, name: 'Bob' } })
    setPersistenceUser('alice')
    expect((await readCurrentSnapshot() as ProjectSnapshot).project.name).toBe('测试')
    expect(await readLegacySnapshot()).toBeUndefined()
  })
  it('签名地址和有效期不持久化，revision 和冲突状态可恢复', () => {
    const saved = persistableSnapshot(snapshot)
    expect(JSON.stringify(saved)).not.toContain('SECRET')
    expect(saved.project.assets.a.accessExpiresAt).toBeUndefined()
    expect(parseSnapshot(saved).cloud).toEqual({ revision: 2, pending: true, conflict: false })
    expect(saved.project.assets.a.storage?.objectKey).toBe('media/key')
    expect(snapshot.project.assets.a.url).toContain('SECRET')
  })
})
