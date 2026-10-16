import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { suiteAssetSchema, suiteProjectSchema, suiteVersionSchema } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { readSuiteBackup, readSuiteBlob, saveSuiteBackup, saveSuiteBlob } from './backup'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
describe('套图本地备份', () => {
  it('账号与运行环境分别隔离图片和元数据', async () => {
    const project = suiteProjectSchema.parse(fixture.project)
    const detail: SuiteProjectDetail = { project, assets: [suiteAssetSchema.parse(fixture.asset)], versions: [], batches: [], operations: [], drafts: [], tasks: [] }
    await saveSuiteBackup(project.actor, detail)
    await saveSuiteBlob(project.actor, project.id, detail.assets[0].assetId, new Blob(['图片']))
    expect((await readSuiteBackup(project.actor, project.id))?.complete).toBe(false)
    expect(await readSuiteBlob({ ...project.actor, runtimeScope: 'preview' }, project.id, detail.assets[0].assetId)).toBeUndefined()
    expect(await readSuiteBackup({ ...project.actor, userId: crypto.randomUUID() }, project.id)).toBeUndefined()
  })
  it('分页读取不丢已完整备份的历史；新增图片后完整标记失效', async () => {
    const project = suiteProjectSchema.parse(fixture.project)
    const version = suiteVersionSchema.parse(fixture.version), asset = suiteAssetSchema.parse(fixture.asset)
    const detail: SuiteProjectDetail = { project, assets: [asset], versions: [version], batches: [], operations: [], drafts: [], tasks: [] }
    await saveSuiteBackup(project.actor, detail, true)
    await saveSuiteBackup(project.actor, { ...detail, versions: [] })
    expect((await readSuiteBackup(project.actor, project.id))?.detail.versions).toHaveLength(1)
    expect((await readSuiteBackup(project.actor, project.id))?.complete).toBe(true)
    await saveSuiteBackup(project.actor, { ...detail, assets: [...detail.assets, { ...asset, assetId: crypto.randomUUID() }] })
    expect((await readSuiteBackup(project.actor, project.id))?.complete).toBe(false)
  })
  it('并发元数据保存按调用次序串行，保留最后的本机修改', async () => {
    const project = suiteProjectSchema.parse(fixture.project)
    const detail: SuiteProjectDetail = { project, assets: [], versions: [], batches: [], operations: [], drafts: [], tasks: [] }
    await Promise.all([saveSuiteBackup(project.actor, detail, false, { ...project.config, title: '第一版' }),
      saveSuiteBackup(project.actor, detail, false, { ...project.config, title: '第二版' })])
    expect((await readSuiteBackup(project.actor, project.id))?.conflictConfig?.title).toBe('第二版')
  })
})
