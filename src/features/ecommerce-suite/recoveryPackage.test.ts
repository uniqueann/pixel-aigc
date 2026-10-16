import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { suiteAssetSchema, suiteProjectSchema, suiteVersionSchema } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { loadFullSuite, verifySuiteBlob } from './recoveryPackage'
import type { SuiteClient } from './api'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const project = suiteProjectSchema.parse(fixture.project)
const asset = { ...suiteAssetSchema.parse(fixture.asset), assetId: project.config.baseAssetId }
const version = { ...suiteVersionSchema.parse(fixture.version), assetId: asset.assetId }
const detail: SuiteProjectDetail = { project, assets: [asset], versions: [version], batches: [], operations: [], drafts: [], tasks: [] }
const client = (last = detail) => ({ get: vi.fn().mockResolvedValueOnce(detail).mockResolvedValue(last),
  versions: vi.fn().mockImplementation((_id, slot) => Promise.resolve({ items: slot === version.slotId ? [version] : [], nextCursor: null })) })
describe('完整恢复快照', () => {
  it('遍历每个槽位历史并再次核对项目，收集完整版本', async () => {
    const api = client()
    expect((await loadFullSuite(api as unknown as SuiteClient, project.id)).versions).toEqual([version])
    expect(api.versions).toHaveBeenCalledTimes(7)
    expect(api.get).toHaveBeenCalledTimes(2)
  })
  it('采集期间配置或候选变化时拒绝标记完整', async () => {
    await expect(loadFullSuite(client({ ...detail, project: { ...project, revision: project.revision + 1 } }) as unknown as SuiteClient, project.id)).rejects.toThrow('备份期间')
    await expect(loadFullSuite(client({ ...detail, versions: [...detail.versions, { ...version, id: crypto.randomUUID() }] }) as unknown as SuiteClient, project.id)).rejects.toThrow('备份期间')
  })
  it('图片必须符合真实字节和 SHA-256，不能凭 Blob 存在就标为完整', async () => {
    const blob = new Blob(['原图'])
    const ref = { ...asset, bytes: blob.size, checksum: createHash('sha256').update('原图').digest('hex') }
    expect(await verifySuiteBlob(blob, ref)).toBe(true)
    expect(await verifySuiteBlob(new Blob(['损坏']), ref)).toBe(false)
  })
})
