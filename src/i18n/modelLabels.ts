import { i18n } from './index'
import zhEmail from './locales/zh-CN/email.json'
import zhWorkstation from './locales/zh-CN/workstation.json'

const MODEL_HINT_TO_KEY: Record<string, string> = {
  [zhWorkstation.models.hints.fast26]: 'workstation:models.hints.fast26',
  [zhWorkstation.models.hints.supports4k]: 'workstation:models.hints.supports4k',
  [zhWorkstation.models.hints.faster]: 'workstation:models.hints.faster',
  [zhWorkstation.models.hints.lowestCost]: 'workstation:models.hints.lowestCost',
  [zhWorkstation.models.hints.value1k]: 'workstation:models.hints.value1k',
  [zhWorkstation.models.hints.samePrice2k]: 'workstation:models.hints.samePrice2k',
  [zhWorkstation.models.hints.maxRef10]: 'workstation:models.hints.maxRef10',
  [zhWorkstation.models.hints.fastGoodText]: 'workstation:models.hints.fastGoodText',
  [zhWorkstation.models.hints.highDetail]: 'workstation:models.hints.highDetail',
  [zhEmail.modelHints.zhBatch]: 'email:modelHints.zhBatch',
  [zhEmail.modelHints.langBatch]: 'email:modelHints.langBatch',
}

export function translateModelHint(hint: string | undefined): string | undefined {
  if (!hint) return undefined
  const key = MODEL_HINT_TO_KEY[hint]
  return key ? i18n.t(key as never) : hint
}
