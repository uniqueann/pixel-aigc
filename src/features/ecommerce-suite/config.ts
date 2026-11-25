import { i18n } from '@/i18n'
import { SUITE_CATEGORY_TEMPLATES, SUITE_TEMPLATE_VERSION } from '@shared/ecommerce-suite-templates'
import { suiteProjectConfigSchema, type SuiteProjectConfig, type SuiteSubcategory } from '@shared/ecommerce-suite'
import { SUITE_RULE_VERSION } from '@shared/ecommerce-suite-precheck'
import { suiteSlotLabel } from './i18n'

export function newSuiteConfig(subcategory: SuiteSubcategory = 'furniture'): SuiteProjectConfig {
  return suiteProjectConfigSchema.parse({ schemaVersion: 1, title: i18n.t('ecommerce:defaults.untitledProduct'), category: 'home-kitchen', subcategory,
    platform: 'amazon', marketplace: 'US', ruleProfile: { id: 'amazon-us-home-kitchen', version: SUITE_RULE_VERSION },
    baseAssetId: crypto.randomUUID(), tags: [], facts: [], copyLanguage: 'en-US', unitSystem: 'imperial',
    style: { palette: ['#f1eee8', '#383b40'], sceneTone: i18n.t('ecommerce:defaults.sceneTone'), templateId: subcategory, templateVersion: SUITE_TEMPLATE_VERSION },
    slots: SUITE_CATEGORY_TEMPLATES[subcategory].slots.map((slot, index) => ({ id: crypto.randomUUID(), key: slot.key, kind: slot.kind,
      name: suiteSlotLabel(slot), order: index, enabled: true, referenceAssetIds: [] })) })
}
export function changeSuiteCategory(config: SuiteProjectConfig, subcategory: SuiteSubcategory): SuiteProjectConfig {
  const template = newSuiteConfig(subcategory)
  return { ...config, subcategory, slots: template.slots, tags: [], style: { ...config.style, templateId: subcategory } }
}
export function suiteFilename(title: string, slotName: string, version: number, size: { width: number; height: number }, mime: string) {
  const clean = (value: string) => [...value].map(char => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char).join('').replace(/^\.+/, '').slice(0, 80) || i18n.t('ecommerce:defaults.filenameFallback')
  return `${clean(title)}_${clean(slotName)}_v${version}_${size.width}x${size.height}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png'}`
}
