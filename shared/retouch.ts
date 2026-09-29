export const RETOUCH_DIRECTION_IDS = ['blemish', 'brighten', 'sharpen', 'texture'] as const

export type RetouchDirection = typeof RETOUCH_DIRECTION_IDS[number]

export const RETOUCH_DIRECTIONS: ReadonlyArray<{
  id: RetouchDirection
  label: string
  instruction: string
}> = [
  { id: 'blemish', label: '去瑕疵', instruction: '去瑕疵：只做轻微照片修图，去掉灰尘、划痕和小脏点。不改形状、颜色和材质。' },
  { id: 'brighten', label: '提亮', instruction: '提亮：只提高曝光和亮度，减轻过暗阴影。不改色相、白平衡，也不改任何部件颜色。' },
  { id: 'sharpen', label: '边缘锐化', instruction: '边缘锐化：只锐化原图已有边缘。不新造细节，不重描轮廓，不改形状。' },
  { id: 'texture', label: '统一质感', instruction: '统一质感：轻微均匀表面光影和质地。不换材质，不改颜色。' },
]

export const RETOUCH_MODEL_PROMPT_MAX = 4000

export const RETOUCH_LEAD = '只做下列轻微照片精修，不要重绘整张图。'

/** 固定约束放在整段提示词末尾，优先级高于补充说明。 */
export const RETOUCH_FIXED_PROMPT = '硬性约束（优先级高于补充说明）：不要改变任何商品或部件的颜色，包括按钮、液体、金属、塑料和包装。不要重绘、改写、重拼或发明任何文字、字母、Logo、铭牌或标签；文字必须保持像素级原样，仅在原本清晰可读时轻微锐化，绝不重写字母。保持整体色相和白平衡。不改构图、形状和背景，不加文字和水印。若补充说明与上述约束冲突，以本段约束为准。'

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

function retouchPromptParts(directions: readonly RetouchDirection[], note?: string) {
  const parts = [RETOUCH_LEAD, ...directions.map(id => instructionFor[id])]
  const extra = note?.trim()
  if (extra) parts.push(`补充说明：${extra}`)
  parts.push(RETOUCH_FIXED_PROMPT)
  return parts
}

/** 补充说明上限按四个方向都选中来预留，少选时限额不变。 */
export const RETOUCH_NOTE_MAX = RETOUCH_MODEL_PROMPT_MAX
  - retouchPromptParts([...RETOUCH_DIRECTION_IDS]).join('\n').length
  - RETOUCH_NOTE_PREFIX.length

export function retouchNoteLimitMessage() {
  return `补充说明最多 ${RETOUCH_NOTE_MAX} 字`
}

export function composeRetouchPrompt(directions: readonly string[], note?: string) {
  return retouchPromptParts(normalizeRetouchDirections(directions), note).join('\n')
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
