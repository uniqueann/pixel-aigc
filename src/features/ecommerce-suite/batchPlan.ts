import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { isSuiteFactReady, type SuiteFact, type SuiteSlotConfig, type SuiteSubcategory } from '@shared/ecommerce-suite'

export interface SuiteRetrySelection {
  batchId: string
  slotIds: string[]
}

export function getSlotUnreadyReason(
  slot: SuiteSlotConfig,
  subcategory: SuiteSubcategory,
  facts: readonly Pick<SuiteFact, 'confirmed' | 'kind' | 'value'>[]
): string {
  if (!slot.enabled) return '已跳过'
  const template = SUITE_CATEGORY_TEMPLATES[subcategory]?.slots.find(item => item.key === slot.key)
  const isDetailRef = template?.strategy === 'detail_reference' || slot.kind === 'detail'
  if (isDetailRef && !slot.referenceAssetIds.length) {
    return '需细节参考图'
  }
  if (slot.kind === 'size') {
    const hasDimension = facts.some(fact => isSuiteFactReady(fact) && ['dimension', 'capacity'].includes(fact.kind))
    if (!hasDimension) return '需添加尺寸规格'
  }
  if (template?.requires.includes('confirmed_facts' as never)) {
    const hasConfirmed = facts.some(isSuiteFactReady)
    if (!hasConfirmed) return '需补充商品卖点'
  }
  return ''
}
