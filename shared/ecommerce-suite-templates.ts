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
      { key: 'main', kind: 'main', name: '白底主图', strategy: 'reuse', requires: ['base_image'] },
      { key: 'scene', kind: 'scene', name: '居室场景', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'secondary', kind: 'atmosphere', name: '氛围场景', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'feature', kind: 'feature', name: '卖点信息图', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'size', kind: 'size', name: '尺寸图', strategy: 'reuse', requires: ['base_image', 'confirmed_facts'] },
      { key: 'detail', kind: 'detail', name: '材质与连接细节', strategy: 'detail_reference', requires: ['detail_image'] },
      { key: 'use', kind: 'use', name: '使用场景', strategy: 'image_edit', requires: ['base_image'] },
    ],
  },
  'kitchen-dining': {
    label: '厨房餐饮', styleTags: ['明亮厨房', '自然光', '操作台场景', '简洁构图', '中性色调', '暖色背景', '成品展示', '柔和阴影'],
    slots: [
      { key: 'main', kind: 'main', name: '白底主图', strategy: 'reuse', requires: ['base_image'] },
      { key: 'scene', kind: 'scene', name: '厨房场景', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'secondary', kind: 'detail', name: '材质与结构说明', strategy: 'detail_reference', requires: ['detail_image', 'confirmed_facts'] },
      { key: 'feature', kind: 'feature', name: '功能卖点图', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'size', kind: 'size', name: '尺寸与容量', strategy: 'reuse', requires: ['base_image', 'confirmed_facts'] },
      { key: 'detail', kind: 'detail', name: '部件细节', strategy: 'detail_reference', requires: ['detail_image'] },
      { key: 'use', kind: 'use', name: '使用与成品场景', strategy: 'image_edit', requires: ['base_image'] },
    ],
  },
  'storage-textile': {
    label: '收纳家纺', styleTags: ['整洁居室', '自然光', '日常使用', '简洁构图', '暖色空间', '中性色调', '柔和阴影', '空间陈列'],
    slots: [
      { key: 'main', kind: 'main', name: '白底主图', strategy: 'reuse', requires: ['base_image'] },
      { key: 'scene', kind: 'scene', name: '居室陈列', strategy: 'image_edit', requires: ['base_image'] },
      { key: 'secondary', kind: 'use', name: '空间与使用对比', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'feature', kind: 'feature', name: '卖点信息图', strategy: 'image_edit', requires: ['base_image', 'confirmed_facts'] },
      { key: 'size', kind: 'size', name: '尺寸与规格', strategy: 'reuse', requires: ['base_image', 'confirmed_facts'] },
      { key: 'detail', kind: 'detail', name: '走线与卡扣细节', strategy: 'detail_reference', requires: ['detail_image'] },
      { key: 'use', kind: 'use', name: '多场景展示', strategy: 'image_edit', requires: ['base_image'] },
    ],
  },
} as const satisfies Record<SuiteSubcategory, CategoryTemplate>
