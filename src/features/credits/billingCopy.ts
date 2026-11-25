import { EMAIL_MODELS } from '@shared/email-models'
import { BG_REMOVE_MONTHLY_FREE, syncCreditPrice, type SyncCreditOperation } from '@shared/billing'
import type { ImageResolution } from '@shared/image-generation'
import { IMAGE_MODEL_PROFILES, type ImageModelProfile } from '@shared/image-models'
import { MAX_EXPAND_PASSES, MAX_SCALE } from '@shared/outpaint'
import { VIDEO_MODELS, videoModelCredits, videoModelModes, videoModelResolutions } from '@shared/video-models'
import { i18n } from '@/i18n'
import { activeLocale } from '@/i18n/format'
import { WORKSTATION_TOOLS } from '@/pages/ImageWorkstation/tools'
import { getNavLabel } from '@/router/meta'

const RESOLUTION_ORDER: ImageResolution[] = ['1k', '2k', '4k']
const PER_IMAGE_SLUGS = ['smart-edit', 'relight', 'variation', 'fusion', 'retouch'] as const
const SYNC_SLUGS = ['remove', 'repaint', 'outpaint'] as const

export interface BillingExplanationCopy {
  summary: string
  groups: Array<{ title: string; items: string[] }>
}

function slash(values: Array<string | number>) {
  return values.join(i18n.t('credits:explanation.slash'))
}

function whole(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function formatBillingMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim())
  if (!match) return ''
  const year = Number(match[1])
  const monthNumber = Number(match[2])
  if (activeLocale() === 'en-US') {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, monthNumber - 1, 1)))
  }
  return i18n.t('credits:explanation.monthYear', { year, month: monthNumber })
}

function workstationToolLabel(slug: string) {
  return i18n.t(`workstation:tools.${slug}` as never)
}

function syncToolLabel(operation: SyncCreditOperation) {
  return i18n.t(`credits:syncTools.${operation}` as never)
}

function strategyLabel(value: 'letterbox' | 'crop' | 'outpaint') {
  return i18n.t(`toolbox:aspectRatio.strategies.${value}` as never)
}

function assertWorkstationToolsCovered() {
  const known = new Set<string>([...PER_IMAGE_SLUGS, ...SYNC_SLUGS])
  const missing = WORKSTATION_TOOLS.filter(tool => !known.has(tool.slug)).map(tool => tool.slug)
  if (missing.length) throw new Error(`Missing billing coverage: ${missing.join(', ')}`)
  const pairs: Array<[typeof SYNC_SLUGS[number], SyncCreditOperation]> = [
    ['remove', 'erase'],
    ['repaint', 'repaint'],
    ['outpaint', 'outpaint'],
  ]
  for (const [slug, operation] of pairs) {
    if (workstationToolLabel(slug) !== syncToolLabel(operation)) {
      throw new Error(`Tool label mismatch for ${slug} / ${operation}`)
    }
  }
}

function pricedResolutions(profile: ImageModelProfile) {
  const rows: Array<{ resolution: ImageResolution; credits: number }> = []
  for (const resolution of RESOLUTION_ORDER) {
    const credits = profile.pricing.creditsPerImage[resolution]
    if (!profile.ui.resolutions.includes(resolution) || typeof credits !== 'number' || !Number.isSafeInteger(credits)) continue
    rows.push({ resolution, credits })
  }
  return rows
}

function downgradeNote(profile: ImageModelProfile) {
  const limited = profile.ui.resolutionRatioConstraints?.['4k']
  const twoK = profile.pricing.creditsPerImage['2k']
  if (!limited?.length || !Number.isSafeInteger(twoK)) return ''
  return i18n.t('credits:explanation.downgrade4k', { credits: twoK })
}

function videoItem() {
  const comma = i18n.t('credits:explanation.comma')
  const sentenceComma = i18n.t('credits:explanation.sentenceComma')
  const semicolon = i18n.t('credits:explanation.semicolon')
  const text = i18n.t('canvas:modes.text-to-video')
  const image = i18n.t('credits:ledger.tools.image-to-video')
  const separator = activeLocale() === 'en-US' ? ' ' : ''
  const modelsText = VIDEO_MODELS.map(model => {
    const prices = videoModelResolutions(model).map(resolution => {
      const parts = model.durations.map(duration => (
        i18n.t('credits:explanation.videoDurationPart', {
          duration,
          credits: videoModelCredits(model, resolution, duration),
        })
      ))
      return i18n.t('credits:explanation.videoResolutionParts', {
        resolution: resolution.toUpperCase(),
        parts: parts.join(sentenceComma),
      })
    })
    const modes = videoModelModes(model).includes('image_to_video') ? `${text}${comma}${image}` : text
    return i18n.t('credits:explanation.videoItem', {
      modes,
      model: model.label,
      prices: prices.join(semicolon),
    })
  }).join(separator)
  return `${modelsText}${separator}${i18n.t('credits:explanation.videoAudioNote')}`
}

function generationItems() {
  assertWorkstationToolsCovered()
  const comma = i18n.t('credits:explanation.comma')
  const period = i18n.t('credits:explanation.period')
  const textToImage = i18n.t('canvas:modes.text-to-image')
  const names = [textToImage, ...PER_IMAGE_SLUGS.map(slug => workstationToolLabel(slug))]
  const enabled = IMAGE_MODEL_PROFILES.filter(profile => profile.enabled && pricedResolutions(profile).length)
  if (!enabled.length) throw new Error('No enabled image model pricing available')
  const groups = new Map<string, { labels: string[]; phrase: string; downgrade: string }>()
  for (const profile of enabled) {
    const rows = pricedResolutions(profile)
    const phrase = i18n.t('credits:explanation.resolutionCredits', {
      resolutions: slash(rows.map(row => row.resolution.toUpperCase())),
      credits: slash(rows.map(row => row.credits)),
    })
    const downgrade = downgradeNote(profile)
    const key = `${phrase}|${downgrade}`
    const current = groups.get(key) ?? { labels: [], phrase, downgrade }
    current.labels.push(profile.label)
    groups.set(key, current)
  }
  const unit = enabled.every(profile => profile.pricing.unit === 'image')
    ? i18n.t('credits:explanation.unitPerImage')
    : i18n.t('credits:explanation.unitPerRequest')
  const priceText = [...groups.values()].map(group => (
    groups.size === 1
      ? group.phrase
      : i18n.t('credits:explanation.modelResolutionGroup', {
        labels: group.labels.join(comma),
        phrase: group.phrase,
      })
  )).join(period)
  const downgrades = [...new Set([...groups.values()].map(group => group.downgrade).filter(Boolean))]
  const items = [
    i18n.t('credits:explanation.generationLead', {
      names: names.join(comma),
      unit,
      priceText,
      downgrades: downgrades.join(activeLocale() === 'en-US' ? ' ' : ''),
    }).trimEnd(),
  ]
  const video = videoItem()
  if (video) items.push(video)
  return items
}

function editItems() {
  const erase = syncCreditPrice('erase')
  const repaint = syncCreditPrice('repaint')
  const onePass = syncCreditPrice('outpaint', 1)
  const maxPassCredits = syncCreditPrice('outpaint', MAX_EXPAND_PASSES)
  const eraseLabel = syncToolLabel('erase')
  const repaintLabel = syncToolLabel('repaint')
  const sameEditPrice = erase === repaint
    ? i18n.t('credits:explanation.editSamePrice', { erase: eraseLabel, repaint: repaintLabel, credits: erase })
    : i18n.t('credits:explanation.editDiffPrice', {
      erase: eraseLabel,
      eraseCredits: erase,
      repaint: repaintLabel,
      repaintCredits: repaint,
    })
  return [
    sameEditPrice,
    i18n.t('credits:explanation.outpaintItem', {
      outpaint: syncToolLabel('outpaint'),
      onePass,
      maxPasses: MAX_EXPAND_PASSES,
      maxCredits: maxPassCredits,
      maxScale: MAX_SCALE,
    }),
  ]
}

function mattingItem(remaining: number, month: string) {
  const billed = syncToolLabel('bg-remove')
  const toolbox = i18n.t('toolbox:tools.bg-remove')
  const name = toolbox === billed ? billed : i18n.t('credits:explanation.mattingCombinedName', { billed, toolbox })
  const when = month
    ? i18n.t('credits:explanation.mattingWhenMonth', { month, remaining })
    : i18n.t('credits:explanation.mattingWhenCurrent', { remaining })
  return i18n.t('credits:explanation.mattingItem', {
    name,
    monthlyFree: BG_REMOVE_MONTHLY_FREE,
    when,
    price: syncCreditPrice('bg-remove'),
  })
}

function freeToolItem() {
  const email = getNavLabel('/email')
  const sentenceComma = i18n.t('credits:explanation.sentenceComma')
  const emailModels = EMAIL_MODELS.map(model => (
    i18n.t('credits:explanation.emailModelCredit', { model: model.label, credits: model.credits })
  )).join(sentenceComma)
  return i18n.t('credits:explanation.freeToolsItem', {
    subject: i18n.t('toolbox:aspectRatio.subjectDetection'),
    smartSelect: i18n.t('toolbox:aspectRatio.smartSelect'),
    letterbox: strategyLabel('letterbox'),
    watermark: i18n.t('toolbox:tools.watermark'),
    localTemplate: i18n.t('toolbox:aspectRatio.localTemplate'),
    crop: strategyLabel('crop'),
    pipeline: i18n.t('toolbox:tools.pipeline'),
    outpaintStrategy: strategyLabel('outpaint'),
    outpaint: syncToolLabel('outpaint'),
    email,
    emailModels,
  })
}

function refundItems(includeVideo: boolean) {
  const comma = i18n.t('credits:explanation.comma')
  const syncTools = [
    syncToolLabel('erase'),
    syncToolLabel('repaint'),
    syncToolLabel('outpaint'),
    syncToolLabel('bg-remove'),
  ].join(comma)
  const items = [i18n.t('credits:explanation.refundImage')]
  if (includeVideo) items.push(i18n.t('credits:explanation.refundVideo'))
  items.push(i18n.t('credits:explanation.refundSync', {
    tools: syncTools,
    bgRemove: syncToolLabel('bg-remove'),
  }))
  return items
}

export function billingExplanationCopy(input: {
  freeBgRemoveRemaining: number
  freeBgRemoveMonth: string
}): BillingExplanationCopy {
  const remaining = whole(input.freeBgRemoveRemaining)
  const month = formatBillingMonth(input.freeBgRemoveMonth)
  return {
    summary: i18n.t('credits:explanation.summary', { tool: syncToolLabel('bg-remove'), remaining }),
    groups: [
      { title: i18n.t('credits:explanation.groups.generation'), items: generationItems() },
      { title: i18n.t('credits:explanation.groups.edit'), items: editItems() },
      { title: i18n.t('credits:explanation.groups.toolbox'), items: [mattingItem(remaining, month), freeToolItem()] },
      { title: i18n.t('credits:explanation.groups.refund'), items: refundItems(Boolean(videoItem())) },
    ],
  }
}
