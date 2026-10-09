import { EMAIL_MODELS } from '@shared/email-models'
import { BG_REMOVE_MONTHLY_FREE, SYNC_TOOL_LABELS, syncCreditPrice, type SyncCreditOperation } from '@shared/billing'
import { creditToolName } from '@shared/credits'
import type { ImageResolution } from '@shared/image-generation'
import { IMAGE_MODEL_PROFILES, type ImageModelProfile } from '@shared/image-models'
import { MAX_EXPAND_PASSES, MAX_SCALE } from '@shared/outpaint'
import { SEEDANCE_VIDEO_MODEL } from '@shared/video-models'
import { CANVAS_MODES } from '@/pages/FreeCanvas/modes'
import { WORKSTATION_TOOLS } from '@/pages/ImageWorkstation/tools'
import { FIT_STRATEGIES } from '@/pages/Toolbox/aspect-ratio/strategies'
import { SUBJECT_DETECTION_LABEL } from '@/pages/Toolbox/aspect-ratio/subjectLabels'
import { LOCAL_TEMPLATE_LABEL } from '@/pages/Toolbox/shared/presetLabels'
import { TOOLBOX_TOOLS } from '@/pages/Toolbox/tools'
import { NAV_META } from '@/router/meta'
import { SMART_SELECT_LABEL } from '@/services/api/smartSelectLabels'

const RESOLUTION_ORDER: ImageResolution[] = ['1k', '2k', '4k']
const PER_IMAGE_SLUGS = ['smart-edit', 'relight', 'variation', 'fusion', 'retouch'] as const
const SYNC_SLUGS = ['remove', 'repaint', 'outpaint'] as const

export interface BillingExplanationCopy {
  summary: string
  groups: Array<{ title: string; items: string[] }>
}

function slash(values: Array<string | number>) {
  return values.join('／')
}

function whole(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function formatBillingMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim())
  if (!match) return ''
  return `${Number(match[1])}年${Number(match[2])}月`
}

function toolLabel(tools: ReadonlyArray<{ slug: string; label: string }>, slug: string) {
  const tool = tools.find(item => item.slug === slug)
  if (!tool) throw new Error(`计费说明缺少工具：${slug}`)
  return tool.label
}

function strategyLabel(value: 'letterbox' | 'crop' | 'outpaint') {
  const item = FIT_STRATEGIES.find(strategy => strategy.value === value)
  if (!item) throw new Error(`计费说明缺少转比例策略：${value}`)
  return item.label
}

function assertWorkstationToolsCovered() {
  const known = new Set<string>([...PER_IMAGE_SLUGS, ...SYNC_SLUGS])
  const missing = WORKSTATION_TOOLS.filter(tool => !known.has(tool.slug)).map(tool => tool.label)
  if (missing.length) throw new Error(`计费说明未覆盖：${missing.join('、')}`)
  const pairs: Array<[typeof SYNC_SLUGS[number], SyncCreditOperation]> = [
    ['remove', 'erase'],
    ['repaint', 'repaint'],
    ['outpaint', 'outpaint'],
  ]
  for (const [slug, operation] of pairs) {
    if (toolLabel(WORKSTATION_TOOLS, slug) !== SYNC_TOOL_LABELS[operation]) {
      throw new Error(`${slug} 的界面名称和计费名称不一致`)
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
  return `当前比例不支持 4K 时改为按 2K 生成，并按 2K 的 ${twoK} 分扣。`
}

function videoItem() {
  const model = SEEDANCE_VIDEO_MODEL
  const parts = model.durations.flatMap(duration => {
    const credits = model.pricing.creditsPerVideo[duration]
    if (!Number.isSafeInteger(credits) || credits < 0) return []
    return [`${duration} 秒 ${credits} 分`]
  })
  if (parts.length !== model.durations.length) return ''
  const text = creditToolName({ mode: 'text_to_video' }, 'text_to_video')
  const image = creditToolName({ mode: 'image_to_video' }, 'text_to_video')
  return `${text}、${image}（${model.label}，${model.resolution}）按条计费：${parts.join('，')}。是否生成声音不改变价格。`
}

function generationItems() {
  assertWorkstationToolsCovered()
  const textToImage = CANVAS_MODES.find(mode => mode.slug === 'text-to-image')
  if (!textToImage) throw new Error('计费说明缺少文生图名称')
  const names = [textToImage.label, ...PER_IMAGE_SLUGS.map(slug => toolLabel(WORKSTATION_TOOLS, slug))]
  const enabled = IMAGE_MODEL_PROFILES.filter(profile => profile.enabled && pricedResolutions(profile).length)
  if (!enabled.length) throw new Error('没有可用的图片单价')
  const groups = new Map<string, { labels: string[]; phrase: string; downgrade: string }>()
  for (const profile of enabled) {
    const rows = pricedResolutions(profile)
    const phrase = `${slash(rows.map(row => row.resolution.toUpperCase()))} 分别扣 ${slash(rows.map(row => row.credits))} 分`
    const key = `${phrase}|${downgradeNote(profile)}`
    const current = groups.get(key) ?? { labels: [], phrase, downgrade: downgradeNote(profile) }
    current.labels.push(profile.label)
    groups.set(key, current)
  }
  const unit = enabled.every(profile => profile.pricing.unit === 'image') ? '每张' : '按次'
  const priceText = [...groups.values()].map(group => (
    groups.size === 1 ? group.phrase : `${group.labels.join('、')}：${group.phrase}`
  )).join('。')
  const downgrades = [...new Set([...groups.values()].map(group => group.downgrade).filter(Boolean))]
  const items = [
    `${names.join('、')}按输出分辨率${unit}计费，${priceText}。提交时按请求张数预扣，成功后只结算成功的张数，未成功的张数退回。${downgrades.join('')}`,
  ]
  const video = videoItem()
  if (video) items.push(video)
  return items
}

function editItems() {
  const erase = syncCreditPrice('erase')
  const repaint = syncCreditPrice('repaint')
  const onePass = syncCreditPrice('outpaint', 1)
  const maxPasses = syncCreditPrice('outpaint', MAX_EXPAND_PASSES)
  const sameEditPrice = erase === repaint
    ? `${SYNC_TOOL_LABELS.erase}、${SYNC_TOOL_LABELS.repaint}每次 ${erase} 分。`
    : `${SYNC_TOOL_LABELS.erase}每次 ${erase} 分。${SYNC_TOOL_LABELS.repaint}每次 ${repaint} 分。`
  return [
    sameEditPrice,
    `${SYNC_TOOL_LABELS.outpaint}按实际扩图轮次计费：1 轮 ${onePass} 分，${MAX_EXPAND_PASSES} 轮 ${maxPasses} 分。每边一轮最多扩到原图该边的 ${MAX_SCALE} 倍；一轮盖不住目标时继续扩，最多 ${MAX_EXPAND_PASSES} 轮。还读不到原图尺寸时最多预扣 ${maxPasses} 分，实际轮次更少会退回差额。`,
  ]
}

function mattingItem(remaining: number, month: string) {
  const billed = SYNC_TOOL_LABELS['bg-remove']
  const toolbox = toolLabel(TOOLBOX_TOOLS, 'bg-remove')
  const name = toolbox === billed ? billed : `${billed}（工具箱里的${toolbox}）`
  const when = month ? `${month}还可免费 ${remaining} 张` : `本月还可免费 ${remaining} 张`
  return `${name}按账号和运行环境计算，每个上海时区自然月免费 ${BG_REMOVE_MONTHLY_FREE} 张。${when}，进入下一个上海自然月后重新获得 ${BG_REMOVE_MONTHLY_FREE} 张。正在处理的免费请求占用额度，失败或超时会释放。超出免费额度后每张 ${syncCreditPrice('bg-remove')} 分。`
}

function freeToolItem() {
  const email = NAV_META['/email']
  if (!email) throw new Error('计费说明缺少邮件助手名称')
  return `${SUBJECT_DETECTION_LABEL}、${SMART_SELECT_LABEL}不单独扣分。${strategyLabel('letterbox')}、${strategyLabel('crop')}、${toolLabel(TOOLBOX_TOOLS, 'watermark')}、${toolLabel(TOOLBOX_TOOLS, 'pipeline')}和${LOCAL_TEMPLATE_LABEL}在本机处理，不扣积分。转比例里的${strategyLabel('outpaint')}按${SYNC_TOOL_LABELS.outpaint}计费。${email}使用平台模型：${EMAIL_MODELS.map(model => `${model.label} 每次成功 ${model.credits} 积分`).join('，')}，失败返还。`
}

function refundItems(includeVideo: boolean) {
  const syncTools = [SYNC_TOOL_LABELS.erase, SYNC_TOOL_LABELS.repaint, SYNC_TOOL_LABELS.outpaint, SYNC_TOOL_LABELS['bg-remove']].join('、')
  const items = [
    '图片任务失败或超时会退回预扣积分；成功后只保留成功张数的费用。截止时间之后才送到的结果不再扣分。',
  ]
  if (includeVideo) items.push('视频任务失败或超时会退回预扣积分。截止时间之后才送到的结果不再扣分。')
  items.push(`${syncTools}失败或超时会退回已扣积分；超时后的结果不会保留，需要重新提交。免费的${SYNC_TOOL_LABELS['bg-remove']}失败或超时会释放本月占用的免费额度。`)
  return items
}

export function billingExplanationCopy(input: {
  freeBgRemoveRemaining: number
  freeBgRemoveMonth: string
}): BillingExplanationCopy {
  const remaining = whole(input.freeBgRemoveRemaining)
  const month = formatBillingMonth(input.freeBgRemoveMonth)
  return {
    summary: `按功能扣分，${SYNC_TOOL_LABELS['bg-remove']}本月还可免费 ${remaining} 张`,
    groups: [
      { title: '生成类', items: generationItems() },
      { title: '编辑类', items: editItems() },
      { title: '抠图与工具', items: [mattingItem(remaining, month), freeToolItem()] },
      { title: '预扣与退还', items: refundItems(Boolean(videoItem())) },
    ],
  }
}
