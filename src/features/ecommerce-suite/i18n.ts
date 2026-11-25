import { ZodError } from 'zod'
import { CloudError } from '@/cloud/client'
import { i18n } from '@/i18n'
import { translateApiError } from '@/i18n/apiErrors'
import { activeLocale, formatNumber } from '@/i18n/format'
import zhEcommerce from '@/i18n/locales/zh-CN/ecommerce.json'
import type { SuiteBridge, SuiteProjectConfig, SuiteSlotConfig, SuiteSubcategory } from '@shared/ecommerce-suite'
import type { SuiteCheck } from '@shared/ecommerce-suite-precheck'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'

const CJK_RE = /[\u4e00-\u9fff]/

/** Default poster text when artwork copyLanguage is zh-CN (derived from zh locale JSON to keep source CJK-free). */
export const DEFAULT_ZH_ARTWORK_TEXT = zhEcommerce.layers.defaultArtworkText

/** Canonical default zh-CN sceneTone from locale JSON, used to display localized default without mutating custom values. */
export const DEFAULT_ZH_SCENE_TONE = zhEcommerce.defaults.sceneTone

const CATEGORY_KEYS = {
  furniture: 'ecommerce:templates.categories.furniture',
  'kitchen-dining': 'ecommerce:templates.categories.kitchen-dining',
  'storage-textile': 'ecommerce:templates.categories.storage-textile',
} as const satisfies Record<SuiteSubcategory, string>

const SLOT_KEYS: Record<string, string> = {
  'main:main': 'ecommerce:templates.slots.main',
  'scene:scene': 'ecommerce:templates.slots.scene',
  'secondary:atmosphere': 'ecommerce:templates.slots.secondaryAtmosphere',
  'secondary:detail': 'ecommerce:templates.slots.secondaryStructure',
  'secondary:use': 'ecommerce:templates.slots.secondaryCompare',
  'feature:feature': 'ecommerce:templates.slots.feature',
  'size:size': 'ecommerce:templates.slots.size',
  'detail:detail': 'ecommerce:templates.slots.detail',
  'use:use': 'ecommerce:templates.slots.use',
}

const OPERATION_ERROR_KEYS: Record<string, string> = {
  USER_STOPPED: 'ecommerce:operationErrors.USER_STOPPED',
  PROJECT_DELETED: 'ecommerce:operationErrors.PROJECT_DELETED',
  RECONFIRMED: 'ecommerce:operationErrors.RECONFIRMED',
  DISPATCH_DEADLINE: 'ecommerce:operationErrors.DISPATCH_DEADLINE',
  INSUFFICIENT_CREDITS: 'ecommerce:operationErrors.INSUFFICIENT_CREDITS',
  SUITE_QUOTE_CHANGED: 'ecommerce:operationErrors.SUITE_QUOTE_CHANGED',
  SUITE_BUDGET_EXCEEDED: 'ecommerce:operationErrors.SUITE_BUDGET_EXCEEDED',
  RATE_LIMIT: 'ecommerce:operationErrors.RATE_LIMIT',
  USER_CONCURRENCY: 'ecommerce:operationErrors.USER_CONCURRENCY',
  GLOBAL_CONCURRENCY: 'ecommerce:operationErrors.GLOBAL_CONCURRENCY',
  MODEL_CONCURRENCY: 'ecommerce:operationErrors.MODEL_CONCURRENCY',
  PROVIDER_CONCURRENCY: 'ecommerce:operationErrors.PROVIDER_CONCURRENCY',
  SUITE_ASSET_UNAVAILABLE: 'ecommerce:operationErrors.SUITE_ASSET_UNAVAILABLE',
  IMAGE_EDIT_UNAVAILABLE: 'ecommerce:operationErrors.IMAGE_EDIT_UNAVAILABLE',
  BACKGROUND_SUBMIT_DISABLED: 'ecommerce:operationErrors.BACKGROUND_SUBMIT_DISABLED',
}

const WORKSTATION_TOOL_KEYS = {
  repaint: 'workstation:tools.repaint',
  'smart-edit': 'workstation:tools.smart-edit',
  retouch: 'workstation:tools.retouch',
  relight: 'workstation:tools.relight',
} as const satisfies Record<SuiteBridge['tool'], string>

const SHARED_ERROR_TO_KEY: Record<string, string> = {
  [zhEcommerce.errors.sharedErrors.imageReadFailed]: 'ecommerce:errors.sharedErrors.imageReadFailed',
  [zhEcommerce.errors.sharedErrors.invalidImageFormat]: 'ecommerce:errors.sharedErrors.invalidImageFormat',
  [zhEcommerce.errors.sharedErrors.dimensionFactRequired]: 'ecommerce:errors.sharedErrors.dimensionFactRequired',
  [zhEcommerce.errors.validation.duplicateTags]: 'ecommerce:errors.validation.duplicateTags',
  [zhEcommerce.errors.validation.duplicateFactIds]: 'ecommerce:errors.validation.duplicateFactIds',
  [zhEcommerce.errors.validation.conflictingDimensionAxis]: 'ecommerce:errors.validation.conflictingDimensionAxis',
  [zhEcommerce.errors.validation.confirmedFactsOnly]: 'ecommerce:errors.validation.confirmedFactsOnly',
  [zhEcommerce.errors.validation.duplicateRefs]: 'ecommerce:errors.validation.duplicateRefs',
  [zhEcommerce.errors.validation.amazonMarketplaceRequired]: 'ecommerce:errors.validation.amazonMarketplaceRequired',
  [zhEcommerce.errors.validation.uniqueMainRequired]: 'ecommerce:errors.validation.uniqueMainRequired',
  [zhEcommerce.errors.validation.enableAtLeastOneSlot]: 'ecommerce:errors.validation.enableAtLeastOneSlot',
  [zhEcommerce.errors.validation.duplicateLayerIds]: 'ecommerce:errors.validation.duplicateLayerIds',
  [zhEcommerce.errors.validation.emptyFinalText]: 'ecommerce:errors.validation.emptyFinalText',
  [zhEcommerce.errors.validation.dimensionRequiresConfirmedFact]: 'ecommerce:errors.validation.dimensionRequiresConfirmedFact',
  [zhEcommerce.errors.validation.degenerateDimensionLine]: 'ecommerce:errors.validation.degenerateDimensionLine',
  [zhEcommerce.errors.validation.amazonWebpUnsupported]: 'ecommerce:errors.validation.amazonWebpUnsupported',
  [zhEcommerce.errors.validation.jpegTransparentUnsupported]: 'ecommerce:errors.validation.jpegTransparentUnsupported',
  [zhEcommerce.errors.validation.titleRequired]: 'ecommerce:errors.validation.titleRequired',
  [zhEcommerce.errors.validation.invalidConfig]: 'ecommerce:errors.validation.invalidConfig',
}

export function suitePlatformLabel(platform: SuiteProjectConfig['platform']): string {
  return i18n.t(platform === 'amazon' ? 'ecommerce:platforms.amazon' : 'ecommerce:platforms.general')
}

export function suiteCategoryLabel(subcategory: SuiteSubcategory): string {
  return i18n.t(CATEGORY_KEYS[subcategory])
}

export function suiteSlotLabel(slot: Pick<SuiteSlotConfig, 'key' | 'kind' | 'name'>): string {
  const key = SLOT_KEYS[`${slot.key}:${slot.kind}`]
  return key ? i18n.t(key as never) : slot.name
}

export function suiteStyleTagOptions(subcategory: SuiteSubcategory): { value: string; label: string }[] {
  return SUITE_CATEGORY_TEMPLATES[subcategory].styleTags.map((tag, index) => ({
    value: tag,
    label: i18n.t(`ecommerce:templates.styleTags.${subcategory}.${index}` as never),
  }))
}

export function suiteOperationErrorText(code: string): string {
  const key = OPERATION_ERROR_KEYS[code]
  return key ? i18n.t(key as never) : i18n.t('ecommerce:operationErrors.default')
}

export function suiteWorkstationToolLabel(tool: SuiteBridge['tool']): string {
  return i18n.t(WORKSTATION_TOOL_KEYS[tool])
}

export function suiteSceneToneLabel(sceneTone: string | undefined): string {
  if (!sceneTone) return i18n.t('ecommerce:plan.defaultTone')
  if (sceneTone === DEFAULT_ZH_SCENE_TONE) return i18n.t('ecommerce:defaults.sceneTone')
  return sceneTone
}

export function formatSuiteError(error: unknown, fallbackKey = 'ecommerce:errors.actionFailed'): string {
  const fallback = i18n.t(fallbackKey as never)

  if (error instanceof ZodError) {
    const issue = error.issues[0]
    if (issue) {
      const mapped = SHARED_ERROR_TO_KEY[issue.message]
      if (mapped) return i18n.t(mapped as never)
      if (issue.path[0] === 'title' && issue.code === 'too_small') {
        return i18n.t('ecommerce:errors.validation.titleRequired')
      }
      if (activeLocale() === 'zh-CN' && issue.message) return issue.message
      if (issue.message && !CJK_RE.test(issue.message)) return issue.message
    }
    return i18n.t('ecommerce:errors.validation.invalidConfig')
  }

  if (error instanceof CloudError) {
    return translateApiError({
      code: error.code,
      extra: error.extra,
      message: error.message,
      status: error.status,
      fallback,
    })
  }

  if (error instanceof Error) {
    const raw = error.message.trim()
    if (!raw) return fallback
    const mapped = SHARED_ERROR_TO_KEY[raw]
    if (mapped) return i18n.t(mapped as never)
    return translateApiError({
      message: raw,
      fallback,
    })
  }

  return fallback
}

function isSubcategory(value: string): value is SuiteSubcategory {
  return value === 'furniture' || value === 'kitchen-dining' || value === 'storage-textile'
}

export function localizeSuiteCheck(check: SuiteCheck, subcategory?: SuiteSubcategory): SuiteCheck {
  if (activeLocale() === 'zh-CN') return check

  const fallbackEvidence = i18n.t('ecommerce:export.checks.fallbackEvidence')
  const safeEvidence = (value: string) => (CJK_RE.test(value) ? fallbackEvidence : value)

  switch (check.ruleId) {
    case 'file.encode':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.fileEncodeTitle'),
        evidence: translateApiError({
          message: check.evidence,
          fallback: i18n.t('ecommerce:export.errors.encodeFailed'),
        }),
        advice: i18n.t('ecommerce:export.checks.fileEncodeAdvice'),
      }
    case 'snapshot.asset': {
      const idMatch = check.evidence.match(/([0-9a-f-]{36})/i)
      const checksumMatch = check.evidence.match(/SHA-256\s+([a-f0-9]+)/i)
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.snapshotAssetTitle'),
        evidence: idMatch && checksumMatch
          ? i18n.t('ecommerce:export.checks.snapshotAssetEvidence', { assetId: idMatch[1], checksum: checksumMatch[1] })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.snapshotAssetAdvice'),
      }
    }
    case 'snapshot.composition':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.snapshotCompositionTitle'),
        evidence: i18n.t('ecommerce:export.checks.snapshotCompositionEvidence'),
        advice: i18n.t('ecommerce:export.checks.snapshotCompositionAdvice'),
      }
    case 'facts.size':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.factsSizeTitle'),
        evidence: i18n.t(
          check.state === 'pass'
            ? 'ecommerce:export.checks.factsSizeEvidencePass'
            : 'ecommerce:export.checks.factsSizeEvidenceFail',
        ),
        advice: i18n.t('ecommerce:export.checks.factsSizeAdvice'),
      }
    case 'renderer.version':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.rendererVersionTitle'),
        evidence: safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.rendererVersionAdvice'),
      }
    case 'output.platform':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.outputPlatformTitle'),
        evidence: i18n.t('ecommerce:export.checks.outputPlatformEvidence'),
        advice: i18n.t('ecommerce:export.checks.outputPlatformAdvice'),
      }
    case 'output.memory': {
      const sizeMatch = check.evidence.match(/(\d+\u00d7\d+)/)
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.outputMemoryTitle'),
        evidence: sizeMatch
          ? i18n.t('ecommerce:export.checks.outputMemoryEvidence', { size: sizeMatch[1] })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.outputMemoryAdvice'),
      }
    }
    case 'output.aspect':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.outputAspectTitle'),
        evidence: i18n.t('ecommerce:export.checks.outputAspectEvidence'),
        advice: i18n.t('ecommerce:export.checks.outputAspectAdvice'),
      }
    case 'output.upscale': {
      const sizes = check.evidence.match(/\d+\u00d7\d+/g)
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.outputUpscaleTitle'),
        evidence: sizes && sizes.length >= 2
          ? i18n.t('ecommerce:export.checks.outputUpscaleEvidence', { sourceSize: sizes[0], outputSize: sizes[1] })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.outputUpscaleAdvice'),
      }
    }
    case 'amazon.longest': {
      const longestMatch = check.evidence.match(/(\d+)px/i)
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonLongestTitle'),
        evidence: longestMatch
          ? i18n.t('ecommerce:export.checks.amazonLongestEvidence', { longest: longestMatch[1] })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.amazonLongestAdvice'),
      }
    }
    case 'amazon.format':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonFormatTitle'),
        evidence: safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.amazonFormatAdvice'),
      }
    case 'amazon.zoom':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonZoomTitle'),
        evidence: i18n.t('ecommerce:export.checks.amazonZoomEvidence'),
        advice: i18n.t('ecommerce:export.checks.amazonZoomAdvice'),
      }
    case 'amazon.main.layers': {
      const countMatch = check.evidence.match(/(\d+)/)
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonMainLayersTitle'),
        evidence: countMatch
          ? i18n.t('ecommerce:export.checks.amazonMainLayersEvidence', { count: Number(countMatch[1]) })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.amazonMainLayersAdvice'),
      }
    }
    case 'amazon.main.background':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonMainBgTitle'),
        evidence: safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.amazonMainBgAdvice'),
      }
    case 'amazon.main.mask':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonMainMaskTitle'),
        evidence: i18n.t('ecommerce:export.checks.amazonMainMaskEvidence'),
        advice: i18n.t('ecommerce:export.checks.amazonMainMaskAdvice'),
      }
    case 'amazon.category': {
      const catMatch = check.evidence.match(/^(furniture|kitchen-dining|storage-textile)\b/)
      const cat = catMatch && isSubcategory(catMatch[1]) ? catMatch[1] : subcategory
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.amazonCategoryTitle'),
        evidence: cat
          ? i18n.t('ecommerce:export.checks.amazonCategoryEvidence', { category: suiteCategoryLabel(cat) })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.amazonCategoryAdvice'),
      }
    }
    case 'content.manual':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.contentManualTitle'),
        evidence: i18n.t('ecommerce:export.checks.contentManualEvidence'),
        advice: i18n.t('ecommerce:export.checks.contentManualAdvice'),
      }
    case 'file.metadata': {
      const metaMatch = check.evidence.match(
        /^(image\/[a-z]+)[,\uff0c]\s*(\d+\u00d7\d+)[,\uff0c]\s*(\d+)\s*[^\s,\uff0c]+[,\uff0c]\s*SHA-256\s+([a-f0-9]+)/i,
      )
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.fileMetadataTitle'),
        evidence: metaMatch
          ? i18n.t('ecommerce:export.checks.fileMetadataEvidence', {
              mimeType: metaMatch[1],
              size: metaMatch[2],
              bytes: formatNumber(Number(metaMatch[3])),
              checksum: metaMatch[4],
            })
          : safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.fileMetadataAdvice'),
      }
    }
    case 'file.amazon.longest':
      return {
        ...check,
        title: i18n.t('ecommerce:export.checks.fileAmazonLongestTitle'),
        evidence: safeEvidence(check.evidence),
        advice: i18n.t('ecommerce:export.checks.fileAmazonLongestAdvice'),
      }
    default:
      return {
        ...check,
        title: CJK_RE.test(check.title) ? i18n.t('ecommerce:export.checks.fallbackTitle') : check.title,
        evidence: safeEvidence(check.evidence),
        advice: CJK_RE.test(check.advice) ? '' : check.advice,
      }
  }
}
