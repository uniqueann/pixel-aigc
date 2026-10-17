import { describe, expect, it } from 'vitest'
import { newSuiteConfig, changeSuiteCategory, suiteFilename } from './config'
import { suiteProjectConfigSchema } from '@shared/ecommerce-suite'
import { createSuiteEditorStore } from './store'
describe('套图编辑身份', () => {
  it('三类向导生成七个稳定槽位，不预先确认商品事实', () => {
    for (const category of ['furniture', 'kitchen-dining', 'storage-textile'] as const) {
      const config = newSuiteConfig(category)
      expect(suiteProjectConfigSchema.safeParse(config).success).toBe(true)
      expect(config.facts).toEqual([])
      expect(new Set(config.slots.map(slot => slot.id)).size).toBe(7)
    }
    expect(changeSuiteCategory(newSuiteConfig(), 'kitchen-dining').slots[2].kind).toBe('detail')
  })
  it('晚到保存响应不能清除更新过的本地编辑', () => {
    const store = createSuiteEditorStore(), config = newSuiteConfig()
    store.getState().setConfig(config)
    const submittedRevision = store.getState().editRevision
    store.getState().setConfig({ ...config, title: '更新后的资料' })
    store.getState().markSaved(submittedRevision)
    expect(store.getState().dirty).toBe(true)
    expect(store.getState().config?.title).toBe('更新后的资料')
  })
  it('下载名称不包含目录或控制字符，保持真实图片扩展名', () => {
    const name = suiteFilename('../柜子\n', '场景/1', 2, { width: 1024, height: 768 }, 'image/webp')
    expect(name).not.toMatch(/[\n/]/)
    expect(name).toMatch(/_v2_1024x768\.webp$/)
  })
})
