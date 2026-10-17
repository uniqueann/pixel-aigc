import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createResultZip } from '@/pages/Toolbox/shared/zip'
import { readSuiteRecovery, importSuiteRecovery } from './importRecovery'
import type { SuiteClient } from './api'
import { suiteRecoveryManifestSchema } from '@shared/ecommerce-suite-recovery'
vi.mock('./backup', () => ({ saveSuiteBlob: vi.fn().mockResolvedValue(undefined) }))
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json','utf8'))
const image = new Blob(['合成测试图片字节'],{type:'image/png'})
const asset = {assetId:fixture.createProject.config.baseAssetId,mimeType:'image/png',bytes:image.size,size:{width:100,height:100},checksum:createHash('sha256').update('合成测试图片字节').digest('hex'),file:`images/${fixture.createProject.config.baseAssetId}.png`}
const manifest = {format:'pixel-suite-recovery',formatVersion:1,config:{...fixture.createProject.config,slots:fixture.createProject.config.slots.map((slot: {referenceAssetIds:string[]})=>({...slot,referenceAssetIds:[]}))},slotHeads:fixture.project.slotHeads.map((head: object)=>({...head,activeVersionId:null})),versions:[],assets:[asset]}
const inspect = async () => ({width:100,height:100,mimeType:'image/png' as const})
const zip = (value: unknown, files = [{name:asset.file,blob:image}]) => createResultZip([{name:'manifest.json',blob:new Blob([JSON.stringify(value)])},...files])
describe('图片恢复包导入边界', () => {
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
})
