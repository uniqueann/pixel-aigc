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

export const RELIGHT_LEAD = '只重新布置这张商品图的光线，必须让主光方向、受光面、暗部和投影发生肉眼可见的改变。不要重绘商品，不要给整张图套色调或滤镜。'

/** 固定约束放在整段提示词末尾，优先级高于补充说明和色温。 */
export const RELIGHT_FIXED_PROMPT = '硬性约束（优先级高于补充说明和色温）：不要改变商品的形状、结构和材质。不要改变商品本体的固有颜色和白平衡下的本色，包括液体、塑料、金属、按钮、包装和标签。色温只作用于环境光、背景、投影和高光的光源色，禁止给整张图套色调或滤镜。不要重绘、改写、增删任何文字、字母、数字、Logo 或标签，包括单复数和空格，文字必须保持原样。不改构图和背景内容，不加文字和水印。光线方向必须肉眼可见，不能只调色。若补充说明与上述约束冲突，以本段约束为准。'

export const RELIGHT_NOTE_PREFIX = '\n补充说明：'

export const RELIGHT_DIRECTION_INSTRUCTIONS: Record<RelightDirection, string> = {
  top: '顶光：主光从正上方打下，顶部表面高光明显增强，底部和下沿明显变暗，投影落在商品正下方。',
  left: '左光：主光从画面左侧射来，商品左侧受光、左侧面高光明显增强，右侧变暗，投影落向右侧。',
  right: '右光：主光从画面右侧射来，商品右侧受光、右侧面高光明显增强，左侧变暗，投影落向左侧。',
  front: '正面光：主光从镜头方向正面打下，朝向镜头的表面均匀受光，侧面和后方变暗，投影落在商品正后方。',
  bottom: '底光：主光从下方打下，底部和下沿高光明显增强，顶部和上沿变暗，投影向上落在商品上方。',
  back: '逆光：主光从商品背后射来，轮廓边缘出现明显轮廓光，正面偏暗，投影落向镜头、铺在商品前方。',
}

export const RELIGHT_QUALITY_INSTRUCTIONS: Record<RelightQuality, string> = {
  hard: '硬光：高光对比强，投影和高光都有清晰边界。',
  soft: '柔光：高光和阴影过渡柔和，阴影呈渐变、没有清晰边界。',
}

export const RELIGHT_TEMPERATURE_INSTRUCTIONS: Record<RelightTemperature, string> = {
  warm: '暖色温：只让环境光、背景、投影和高光的光源色略偏暖。不要给整张图套黄色或暖色滤镜，不要改变商品本体的固有颜色。',
  neutral: '中性色温：光源保持中性白，不偏暖也不偏冷。不要给整张图套色调，不要改变商品本体的固有颜色。',
  cool: '冷色温：只让环境光、背景、投影和高光的光源色略偏冷。不要给整张图套蓝色或冷色滤镜，不要改变商品本体的固有颜色。',
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
  return [
    RELIGHT_DIRECTION_INSTRUCTIONS[options.direction],
    RELIGHT_QUALITY_INSTRUCTIONS[options.quality],
    RELIGHT_TEMPERATURE_INSTRUCTIONS[options.temperature],
  ].join('\n')
}

function relightPromptParts(options: RelightOptions, note?: string) {
  const parts = [RELIGHT_LEAD, relightOptionLine(options)]
  const extra = note?.trim()
  if (extra) parts.push(`补充说明：${extra}`)
  parts.push(RELIGHT_FIXED_PROMPT)
  return parts
}

const longestRelightBaseLength = Math.max(
  ...RELIGHT_DIRECTIONS.flatMap(direction =>
    RELIGHT_QUALITIES.flatMap(quality =>
      RELIGHT_TEMPERATURES.map(temperature =>
        relightPromptParts({ direction, quality, temperature }).join('\n').length,
      ),
    ),
  ),
)

/** 补充说明上限按最长的一组光效预留。 */
export const RELIGHT_NOTE_MAX = RELIGHT_MODEL_PROMPT_MAX - longestRelightBaseLength - RELIGHT_NOTE_PREFIX.length

export function relightNoteLimitMessage() {
  return `补充说明最多 ${RELIGHT_NOTE_MAX} 字`
}

export function composeRelightPrompt(options: RelightOptions, note?: string) {
  return relightPromptParts(options, note).join('\n')
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
