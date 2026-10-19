import type { SuiteSlotConfig, SuiteSubcategory } from './ecommerce-suite.js'

export const SUITE_TEMPLATE_VERSION = 'home-kitchen-v1'
type SlotTemplate = Pick<SuiteSlotConfig, 'key' | 'kind' | 'name'> & {
  strategy: 'reuse' | 'image_edit' | 'detail_reference'
  requires: readonly ('base_image' | 'confirmed_facts' | 'detail_image')[]
}
interface CategoryTemplate {
  label: string
  styleTags: readonly string[]
  slots: readonly SlotTemplate[]
}

/** 推荐项只提供风格，不自动断言材质、尺寸或性能。 */
export const SUITE_CATEGORY_TEMPLATES = {
  furniture: {
    label: '家具家居', styleTags: ['现代简约', '自然光', '暖光场景', '浅色木地板', '中性色调', '留白构图', '居室搭配', '柔和阴影'],
    slots: [
      { key: 'main', kind: 'main', name: '主图 1 · 白底', strategy: 'reuse', requires: ['base_image'] },
      { key: 'scene', kind: 'scene', name: '主图 2 · 场景', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'secondary', kind: 'atmosphere', name: '主图 3 · 氛围', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'feature', kind: 'feature', name: '主图 4 · 卖点', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'size', kind: 'size', name: '主图 5 · 尺寸', strategy: 'reuse', requires: ['base_image', 'confirmed_facts'] },
      { key: 'detail', kind: 'detail', name: '主图 6 · 细节', strategy: 'detail_reference', requires: ['detail_image'] },
      { key: 'use', kind: 'use', name: '主图 7 · 应用', strategy: 'image_edit', requires: ['base_image'] },
    ],
  },
  'kitchen-dining': {
    label: '厨房餐饮', styleTags: ['明亮厨房', '自然光', '操作台场景', '简洁构图', '中性色调', '暖色背景', '成品展示', '柔和阴影'],
    slots: [
      { key: 'main', kind: 'main', name: '主图 1 · 白底', strategy: 'reuse', requires: ['base_image'] },
      { key: 'scene', kind: 'scene', name: '主图 2 · 场景', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'secondary', kind: 'detail', name: '主图 3 · 结构', strategy: 'detail_reference', requires: ['detail_image', 'confirmed_facts'] },
      { key: 'feature', kind: 'feature', name: '主图 4 · 卖点', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'size', kind: 'size', name: '主图 5 · 尺寸', strategy: 'reuse', requires: ['base_image', 'confirmed_facts'] },
      { key: 'detail', kind: 'detail', name: '主图 6 · 细节', strategy: 'detail_reference', requires: ['detail_image'] },
      { key: 'use', kind: 'use', name: '主图 7 · 应用', strategy: 'image_edit', requires: ['base_image'] },
    ],
  },
  'storage-textile': {
    label: '收纳家纺', styleTags: ['整洁居室', '自然光', '日常使用', '简洁构图', '暖色空间', '中性色调', '柔和阴影', '空间陈列'],
    slots: [
      { key: 'main', kind: 'main', name: '主图 1 · 白底', strategy: 'reuse', requires: ['base_image'] },
      { key: 'scene', kind: 'scene', name: '主图 2 · 场景', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'secondary', kind: 'use', name: '主图 3 · 对比', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'feature', kind: 'feature', name: '主图 4 · 卖点', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'size', kind: 'size', name: '主图 5 · 尺寸', strategy: 'reuse', requires: ['base_image', 'confirmed_facts'] },
      { key: 'detail', kind: 'detail', name: '主图 6 · 细节', strategy: 'detail_reference', requires: ['detail_image'] },
      { key: 'use', kind: 'use', name: '主图 7 · 应用', strategy: 'image_edit', requires: ['base_image'] },
    ],
  },
} as const satisfies Record<SuiteSubcategory, CategoryTemplate>
