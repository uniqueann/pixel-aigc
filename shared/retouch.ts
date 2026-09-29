export const RETOUCH_DIRECTION_IDS = ['blemish', 'brighten', 'sharpen', 'texture'] as const

export type RetouchDirection = typeof RETOUCH_DIRECTION_IDS[number]

export const RETOUCH_DIRECTIONS: ReadonlyArray<{
  id: RetouchDirection
  label: string
  instruction: string
}> = [
  { id: 'blemish', label: '去瑕疵', instruction: '去瑕疵：去掉灰尘、划痕和小瑕疵。印刷文字、Logo 和本来就有的图案留下。' },
  { id: 'brighten', label: '提亮', instruction: '提亮：略微提亮，减轻过暗的阴影。不改商品颜色。' },
  { id: 'sharpen', label: '边缘锐化', instruction: '边缘锐化：让商品边缘更清楚。不新造细节，不改轮廓。' },
  { id: 'texture', label: '统一质感', instruction: '统一质感：让商品表面的光线和质地更均匀。不换材质。' },
]

export const RETOUCH_MODEL_PROMPT_MAX = 4000

export const RETOUCH_FIXED_PROMPT = '保持原图的构图、商品形状、颜色、表面纹理、印刷文字和 Logo 不变。只做下面列出的精修，不改背景，不重绘商品，不加文字和水印。'

export const RETOUCH_NOTE_PREFIX = '\n补充说明：'

const instructionFor = Object.fromEntries(RETOUCH_DIRECTIONS.map(item => [item.id, item.instruction])) as Record<RetouchDirection, string>
const labelFor = Object.fromEntries(RETOUCH_DIRECTIONS.map(item => [item.id, item.label])) as Record<RetouchDirection, string>

/** 按面板顺序保留选中的方向，丢掉重复和未知值。 */
export function normalizeRetouchDirections(values: readonly string[] | undefined): RetouchDirection[] {
  const selected = new Set(values ?? [])
  return RETOUCH_DIRECTION_IDS.filter(id => selected.has(id))
}

export function retouchDirectionLabel(id: RetouchDirection) {
  return labelFor[id]
}

function retouchBasePrompt(directions: readonly RetouchDirection[]) {
  return [RETOUCH_FIXED_PROMPT, ...directions.map(id => instructionFor[id])].join('\n')
}

/** 补充说明上限按四个方向都选中来预留，少选时限额不变。 */
export const RETOUCH_NOTE_MAX = RETOUCH_MODEL_PROMPT_MAX
  - retouchBasePrompt([...RETOUCH_DIRECTION_IDS]).length
  - RETOUCH_NOTE_PREFIX.length

export function retouchNoteLimitMessage() {
  return `补充说明最多 ${RETOUCH_NOTE_MAX} 字`
}

export function composeRetouchPrompt(directions: readonly string[], note?: string) {
  const selected = normalizeRetouchDirections(directions)
  const base = retouchBasePrompt(selected)
  const extra = note?.trim()
  if (!extra) return base
  return `${base}${RETOUCH_NOTE_PREFIX}${extra}`
}

/** 历史记录展示方向名称和用户补充，不保存整段固定句。 */
export function retouchHistoryText(directions: readonly string[], note?: string) {
  const labels = normalizeRetouchDirections(directions).map(id => labelFor[id])
  const extra = note?.trim()
  if (!labels.length) return extra || undefined
  return extra ? `${labels.join('、')}。${extra}` : labels.join('、')
}

export function readRetouchDirections(params: unknown): RetouchDirection[] {
  if (!params || typeof params !== 'object' || !('retouchDirections' in params)) return []
  const value = (params as { retouchDirections?: unknown }).retouchDirections
  if (!Array.isArray(value)) return []
  return normalizeRetouchDirections(value.filter((item): item is string => typeof item === 'string'))
}
