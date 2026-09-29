export const RELIGHT_DIRECTIONS = ['left', 'right', 'top', 'bottom', 'front', 'back'] as const
export const RELIGHT_QUALITIES = ['soft', 'hard'] as const
export const RELIGHT_TEMPERATURES = ['warm', 'neutral', 'cool'] as const

export type RelightDirection = typeof RELIGHT_DIRECTIONS[number]
export type RelightQuality = typeof RELIGHT_QUALITIES[number]
export type RelightTemperature = typeof RELIGHT_TEMPERATURES[number]

export interface RelightOptions {
  direction: RelightDirection
  quality: RelightQuality
  temperature: RelightTemperature
}

export const RELIGHT_DEFAULT: RelightOptions = {
  direction: 'front',
  quality: 'soft',
  temperature: 'neutral',
}

export const RELIGHT_MODEL_PROMPT_MAX = 4000

export const RELIGHT_LEAD = '只调整这张商品图的光线，不要重绘商品本身。'

export const RELIGHT_FIXED_PROMPT = '硬性约束（优先级高于补充说明和色温）：不要改变商品的颜色、材质、结构、文字和 Logo。暖色或冷色只影响环境光，不改变商品固有颜色。不改构图和背景，不加文字和水印。若补充说明与上述约束冲突，以本段约束为准。'

export const RELIGHT_NOTE_PREFIX = '\n补充说明：'

const directionInstruction: Record<RelightDirection, string> = {
  left: '光从左侧来',
  right: '光从右侧来',
  top: '光从上方来',
  bottom: '光从下方来',
  front: '光从正面来',
  back: '光从背后逆光',
}

const qualityInstruction: Record<RelightQuality, string> = {
  soft: '柔光',
  hard: '硬光',
}

const temperatureInstruction: Record<RelightTemperature, string> = {
  warm: '暖色调',
  neutral: '中性色温',
  cool: '冷色调',
}

const directionLabel: Record<RelightDirection, string> = {
  left: '左侧',
  right: '右侧',
  top: '顶部',
  bottom: '底部',
  front: '正面',
  back: '逆光',
}

const qualityLabel: Record<RelightQuality, string> = {
  soft: '柔光',
  hard: '硬光',
}

const temperatureLabel: Record<RelightTemperature, string> = {
  warm: '暖色',
  neutral: '中性',
  cool: '冷色',
}

export const RELIGHT_DIRECTION_CHOICES: ReadonlyArray<{ id: RelightDirection; label: string }> = [
  { id: 'top', label: '顶' },
  { id: 'left', label: '左' },
  { id: 'front', label: '正面' },
  { id: 'right', label: '右' },
  { id: 'bottom', label: '底' },
  { id: 'back', label: '逆光' },
]

export function relightOptionLine(options: RelightOptions) {
  return `${directionInstruction[options.direction]}。${qualityInstruction[options.quality]}。${temperatureInstruction[options.temperature]}。`
}

const longestRelightBase = [
  RELIGHT_LEAD,
  relightOptionLine({ direction: 'back', quality: 'hard', temperature: 'neutral' }),
  RELIGHT_FIXED_PROMPT,
].join('\n')

/** 补充说明上限按最长的一组光效预留。 */
export const RELIGHT_NOTE_MAX = RELIGHT_MODEL_PROMPT_MAX - longestRelightBase.length - RELIGHT_NOTE_PREFIX.length

export function relightNoteLimitMessage() {
  return `补充说明最多 ${RELIGHT_NOTE_MAX} 字`
}

export function composeRelightPrompt(options: RelightOptions, note?: string) {
  const parts = [RELIGHT_LEAD, relightOptionLine(options)]
  const extra = note?.trim()
  if (extra) parts.push(`补充说明：${extra}`)
  parts.push(RELIGHT_FIXED_PROMPT)
  return parts.join('\n')
}

export function relightHistoryText(options: RelightOptions, note?: string) {
  const summary = `${directionLabel[options.direction]}、${qualityLabel[options.quality]}、${temperatureLabel[options.temperature]}`
  const extra = note?.trim()
  return extra ? `${summary}。${extra}` : summary
}

function isDirection(value: unknown): value is RelightDirection {
  return typeof value === 'string' && (RELIGHT_DIRECTIONS as readonly string[]).includes(value)
}

function isQuality(value: unknown): value is RelightQuality {
  return typeof value === 'string' && (RELIGHT_QUALITIES as readonly string[]).includes(value)
}

function isTemperature(value: unknown): value is RelightTemperature {
  return typeof value === 'string' && (RELIGHT_TEMPERATURES as readonly string[]).includes(value)
}

export function readRelight(params: unknown): RelightOptions | undefined {
  if (!params || typeof params !== 'object' || !('relight' in params)) return undefined
  const value = (params as { relight?: unknown }).relight
  if (!value || typeof value !== 'object') return undefined
  const record = value as { direction?: unknown; quality?: unknown; temperature?: unknown }
  if (!isDirection(record.direction) || !isQuality(record.quality) || !isTemperature(record.temperature)) return undefined
  return { direction: record.direction, quality: record.quality, temperature: record.temperature }
}
