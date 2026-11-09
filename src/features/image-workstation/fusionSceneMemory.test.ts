// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetFusionScene, readFusionScene, readFusionSceneMeta, rememberFusionScene } from './fusionSceneMemory'

const OWNER = 'owner-a'
const OTHER = 'owner-b'
const scene = { blob: new Blob(['scene'], { type: 'image/png' }), name: '客厅.png', width: 1200, height: 800, mimeType: 'image/png' }

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('pixel-aigc-fusion-scene')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
})

describe('融合上次场景', () => {
  it('保存后可分别读取元数据和图片', async () => {
    await rememberFusionScene(OWNER, scene)
    expect(await readFusionSceneMeta(OWNER)).toMatchObject({ name: '客厅.png', width: 1200, height: 800, mimeType: 'image/png' })
    const saved = await readFusionScene(OWNER)
    expect(saved?.blob.size).toBe(5)
    expect(await saved!.blob.text()).toBe('scene')
  })
  it('不同账号互不可见', async () => {
    await rememberFusionScene(OWNER, scene)
    expect(await readFusionSceneMeta(OTHER)).toBeUndefined()
    expect(await readFusionScene(OTHER)).toBeUndefined()
  })
  it('再次保存会覆盖上一张场景', async () => {
    await rememberFusionScene(OWNER, scene)
    await rememberFusionScene(OWNER, { ...scene, name: '厨房.png', width: 640, height: 480 })
    expect(await readFusionSceneMeta(OWNER)).toMatchObject({ name: '厨房.png', width: 640, height: 480 })
    expect((await readFusionScene(OWNER))?.name).toBe('厨房.png')
  })
  it('忘记后元数据与图片一起删除', async () => {
    await rememberFusionScene(OWNER, scene)
    await forgetFusionScene(OWNER)
    expect(await readFusionSceneMeta(OWNER)).toBeUndefined()
    expect(await readFusionScene(OWNER)).toBeUndefined()
  })
})
