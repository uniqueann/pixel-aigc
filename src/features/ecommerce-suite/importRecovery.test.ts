import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createResultZip } from '@/pages/Toolbox/shared/zip'
import { CloudError } from '@/cloud/client'
import { readSuiteRecovery, importSuiteRecovery } from './importRecovery'
import type { SuiteClient } from './api'
import { readSuiteRecoveryAttempt, saveSuiteRecoveryAttempt } from './backup'
import { suiteRecoveryManifestSchema } from '@shared/ecommerce-suite-recovery'
vi.mock('./backup', () => ({ saveSuiteBlob: vi.fn().mockResolvedValue(undefined), archiveSuiteDraft: vi.fn().mockResolvedValue(undefined),
  readSuiteRecoveryAttempt: vi.fn().mockResolvedValue(undefined), saveSuiteRecoveryAttempt: vi.fn().mockResolvedValue(undefined) }))
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json','utf8'))
const image = new Blob(['合成测试图片字节'],{type:'image/png'})
const asset = {assetId:fixture.createProject.config.baseAssetId,mimeType:'image/png',bytes:image.size,size:{width:100,height:100},checksum:createHash('sha256').update('合成测试图片字节').digest('hex'),file:`images/${fixture.createProject.config.baseAssetId}.png`}
const manifest = {format:'pixel-suite-recovery',formatVersion:1,config:{...fixture.createProject.config,slots:fixture.createProject.config.slots.map((slot: {referenceAssetIds:string[]})=>({...slot,referenceAssetIds:[]}))},slotHeads:fixture.project.slotHeads.map((head: object)=>({...head,activeVersionId:null})),versions:[],assets:[asset]}
const inspect = async () => ({width:100,height:100,mimeType:'image/png' as const})
const zip = (value: unknown, files = [{name:asset.file,blob:image}]) => createResultZip([{name:'manifest.json',blob:new Blob([JSON.stringify(value)])},...files])
describe('图片恢复包导入边界', () => {
  beforeEach(() => {
    vi.mocked(readSuiteRecoveryAttempt).mockResolvedValue(undefined)
    vi.mocked(saveSuiteRecoveryAttempt).mockResolvedValue(undefined)
  })
  it('实际解压并校验清单与每张图片，任务字段不能作为恢复输入', async () => {
    const result=await readSuiteRecovery(await zip(manifest),inspect)
    expect(result.images.get(asset.assetId)?.size).toBe(image.size)
    await expect(readSuiteRecovery(await zip({...manifest,batches:[fixture.batch]}),inspect)).rejects.toThrow()
    await expect(readSuiteRecovery(await zip(manifest,[{name:'images/escape.png',blob:image}]),inspect)).rejects.toThrow('不安全')
  })
  it('缺失、损坏、伪造格式与像素全部拒绝，不能创建半可信项目', async () => {
    await expect(readSuiteRecovery(await zip(manifest,[]),inspect)).rejects.toThrow('清单外')
    await expect(readSuiteRecovery(await zip({...manifest,assets:[{...asset,checksum:'0'.repeat(64)}]}),inspect)).rejects.toThrow('校验值')
    await expect(readSuiteRecovery(await zip(manifest),async()=>({...await inspect(),width:101}))).rejects.toThrow('真实格式或像素')
  })
  it('恢复清单保留历史无图层 suite-base-v1，不改写渲染器', () => {
    const version = structuredClone(fixture.version)
    version.assetId = asset.assetId
    version.composition.rendererVersion = 'suite-base-v1'
    version.composition.layersSnapshot = []
    const parsed = suiteRecoveryManifestSchema.parse({ ...manifest, versions: [version],
      slotHeads: manifest.slotHeads.map((head: { slotId: string; activeVersionId: string | null }) => head.slotId === version.slotId ? { ...head, activeVersionId: version.id } : head) })
    expect(parsed.versions[0].composition.rendererVersion).toBe('suite-base-v1')
    expect(parsed.versions[0].composition.layersSnapshot).toEqual([])
  })
  it('同一恢复包的重试复用创建、上传和导入身份，提交不携带原任务', async () => {
    const project={...fixture.project,id:crypto.randomUUID()}
    const client={assertCurrent:vi.fn(),create:vi.fn().mockResolvedValue(project),upload:vi.fn().mockResolvedValue({}),restoreSnapshot:vi.fn().mockResolvedValue(project)}
    const input={manifest:suiteRecoveryManifestSchema.parse(manifest),images:new Map([[asset.assetId,image]])}
    const actor=fixture.project.actor
    await importSuiteRecovery(client as unknown as SuiteClient,actor,input,'same-file')
    await importSuiteRecovery(client as unknown as SuiteClient,actor,input,'same-file')
    expect(client.create.mock.calls[0]).toEqual(client.create.mock.calls[1])
    expect(client.restoreSnapshot.mock.calls[0]).toEqual(client.restoreSnapshot.mock.calls[1])
    expect(client.restoreSnapshot.mock.calls[0][1]).not.toHaveProperty('batches')
  })
  it('原恢复项目已删除时，换用持久化随机身份重建全部 ID 并重试', async () => {
    const project={...fixture.project,id:crypto.randomUUID()}
    const create=vi.fn()
      .mockRejectedValueOnce(new CloudError(409,'原恢复项目已删除','SUITE_PROJECT_DELETED'))
      .mockResolvedValueOnce(project)
    const client={assertCurrent:vi.fn(),create,upload:vi.fn().mockResolvedValue({}),restoreSnapshot:vi.fn().mockResolvedValue(project)}
    const input={manifest:suiteRecoveryManifestSchema.parse(manifest),images:new Map([[asset.assetId,image]])}
    const actor=fixture.project.actor

    await importSuiteRecovery(client as unknown as SuiteClient,actor,input,'deleted-file')

    // 不能沿用旧行占用的确定性身份，创建请求与资产 ID 都必须换新。
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0]).not.toBe(create.mock.calls[1][0])
    expect(create.mock.calls[0][1].baseAssetId).not.toBe(create.mock.calls[1][1].baseAssetId)
    expect(saveSuiteRecoveryAttempt).toHaveBeenCalledWith(actor,'deleted-file',expect.any(String))
    const nonce=vi.mocked(saveSuiteRecoveryAttempt).mock.calls[0][2]
    const retryRequestId=create.mock.calls[1][0], retryBaseAssetId=create.mock.calls[1][1].baseAssetId

    // 网络中断后再次导入沿用已保存的随机种子，找回刚创建的恢复项目。
    create.mockClear(); create.mockResolvedValue(project)
    vi.mocked(readSuiteRecoveryAttempt).mockResolvedValue({nonce})
    await importSuiteRecovery(client as unknown as SuiteClient,actor,input,'deleted-file')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toBe(retryRequestId)
    expect(create.mock.calls[0][1].baseAssetId).toBe(retryBaseAssetId)
  })
})
