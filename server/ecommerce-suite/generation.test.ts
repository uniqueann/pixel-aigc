import { describe, expect, it } from 'vitest'
import { planSuiteSlot } from './generation.js'
import type { SuiteProject } from '../../shared/ecommerce-suite.js'
import { SUITE_CATEGORY_TEMPLATES } from '../../shared/ecommerce-suite-templates.js'

function makeTestProject(overrides?: Partial<SuiteProject['config']>): SuiteProject {
  const subcategory = 'furniture'
  const templateSlots = SUITE_CATEGORY_TEMPLATES[subcategory].slots
  const slots = templateSlots.map((item, index) => ({
    id: `slot-${index + 1}`,
    key: item.key,
    kind: item.kind,
    name: item.name,
    enabled: true,
    referenceAssetIds: [],
    order: index,
  }))

  return {
    id: 'proj-1',
    actor: { userId: 'user-1' },
    scope: 'local',
    revision: 1,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slotHeads: [],
    config: {
      title: '测试商品',
      platform: 'general',
      subcategory,
      copyLanguage: 'zh-CN',
      unitSystem: 'metric',
      baseAssetId: 'base-asset-id',
      tags: [],
      facts: [],
      style: { sceneTone: '现代简约', palette: ['原木色'] },
      ruleProfile: { id: 'general', version: 'v1' },
      slots,
      ...overrides,
    },
  } as unknown as SuiteProject
}

describe('生成计划槽位前置校验与友好报错', () => {
  it('当槽位需要商品事实但项目无确认事实时，抛出明确指引的 409 错误', async () => {
    const project = makeTestProject({ facts: [] })
    const featureSlot = project.config.slots.find(s => s.kind === 'feature')!

    await expect(
      planSuiteSlot(null as never, project, { slotId: featureSlot.id, mode: 'image_edit', modelProfileId: 'm1', resolution: '1k', count: 1, note: '' }, null as never)
    ).rejects.toMatchObject({
      status: 409,
      code: 'SUITE_FACTS_REQUIRED',
      message: `【${featureSlot.name}】缺少卖点或规格，请先在“商品信息与规格”中补充并确认`,
    })
  })

  it('当尺寸槽位缺少确认的尺寸/容量规格时，抛出指向规格的 409 错误', async () => {
    // 只有卖点事实，没有尺寸规格事实
    const project = makeTestProject({
      facts: [
        {
          id: 'f-1',
          kind: 'feature',
          name: '高回弹海绵',
          value: '舒适透气',
          originalText: '舒适透气',
          source: 'user',
          confirmed: true,
        },
      ] as never,
    })
    const sizeSlot = project.config.slots.find(s => s.kind === 'size')!

    await expect(
      planSuiteSlot(null as never, project, { slotId: sizeSlot.id, mode: 'reuse' }, null as never)
    ).rejects.toMatchObject({
      status: 409,
      code: 'SUITE_FACTS_REQUIRED',
      message: `【${sizeSlot.name}】缺少尺寸或容量规格，请先在“商品信息与规格”中确认尺寸`,
    })
  })

  it('当细节槽位缺少参考照片时，抛出指引上传特写图的 409 错误', async () => {
    const project = makeTestProject()
    const detailSlot = project.config.slots.find(s => s.kind === 'detail')!

    await expect(
      planSuiteSlot(null as never, project, { slotId: detailSlot.id, mode: 'reuse' }, null as never)
    ).rejects.toMatchObject({
      status: 409,
      code: 'SUITE_ASSET_UNAVAILABLE',
      message: `【${detailSlot.name}】缺少参考照片，请先上传细节特写图`,
    })
  })

  it('当缺少商品主图底图时，抛出指引上传商品照片的 409 错误', async () => {
    const project = makeTestProject({ baseAssetId: '' })
    const mainSlot = project.config.slots.find(s => s.kind === 'main')!

    await expect(
      planSuiteSlot(null as never, project, { slotId: mainSlot.id, mode: 'reuse' }, null as never)
    ).rejects.toMatchObject({
      status: 409,
      code: 'SUITE_ASSET_UNAVAILABLE',
      message: `【${mainSlot.name}】缺少商品主图，请先上传商品照片`,
    })
  })
})
