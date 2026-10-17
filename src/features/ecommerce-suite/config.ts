import { SUITE_CATEGORY_TEMPLATES, SUITE_TEMPLATE_VERSION } from '@shared/ecommerce-suite-templates'
import { suiteProjectConfigSchema, type SuiteProjectConfig, type SuiteSubcategory } from '@shared/ecommerce-suite'
import { SUITE_RULE_VERSION } from '@shared/ecommerce-suite-precheck'

export function newSuiteConfig(subcategory: SuiteSubcategory = 'furniture'): SuiteProjectConfig {
  return suiteProjectConfigSchema.parse({ schemaVersion: 1, title: '未命名商品', category: 'home-kitchen', subcategory,
    platform: 'amazon', marketplace: 'US', ruleProfile: { id: 'amazon-us-home-kitchen', version: SUITE_RULE_VERSION },
    baseAssetId: crypto.randomUUID(), tags: [], facts: [], copyLanguage: 'en-US', unitSystem: 'imperial',
    style: { palette: ['#f1eee8', '#383b40'], sceneTone: '自然光、简洁构图', templateId: subcategory, templateVersion: SUITE_TEMPLATE_VERSION },
    slots: SUITE_CATEGORY_TEMPLATES[subcategory].slots.map((slot, index) => ({ id: crypto.randomUUID(), key: slot.key, kind: slot.kind,
      name: slot.name, order: index, enabled: true, referenceAssetIds: [] })) })
}
export function changeSuiteCategory(config: SuiteProjectConfig, subcategory: SuiteSubcategory): SuiteProjectConfig {
  const template = newSuiteConfig(subcategory)
  return { ...config, subcategory, slots: template.slots, tags: [], style: { ...config.style, templateId: subcategory } }
}
export function suiteFilename(title: string, slotName: string, version: number, size: { width: number; height: number }, mime: string) {
  const clean = (value: string) => [...value].map(char => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('').replace(/^\.+/, '').slice(0, 80) || '商品'
  return `${clean(title)}_${clean(slotName)}_v${version}_${size.width}x${size.height}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'}`
}
