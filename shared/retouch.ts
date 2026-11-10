import { promptLimit } from './prompt-limits.js'

export const RETOUCH_DIRECTION_IDS = ['blemish', 'brighten', 'sharpen', 'texture'] as const

export type RetouchDirection = typeof RETOUCH_DIRECTION_IDS[number]

export const RETOUCH_DIRECTIONS: ReadonlyArray<{
  id: RetouchDirection
  label: string
  /** 面板里的一行说明；与 instruction 相邻维护，避免界面承诺和实际提示词漂移。 */
  hint: string
  instruction: string
}> = [
  { id: 'blemish', label: '去瑕疵', hint: '去掉灰尘、划痕和小脏点，不改形状', instruction: '去瑕疵：只做轻微照片修图，去掉灰尘、划痕和小脏点。不改形状、颜色和材质。' },
  { id: 'brighten', label: '提亮', hint: '提高曝光和亮度，减轻过暗阴影', instruction: '提亮：只提高曝光和亮度，减轻过暗阴影。不改色相、白平衡，也不改任何部件颜色。' },
  { id: 'sharpen', label: '边缘锐化', hint: '只锐化已有边缘，不新造细节', instruction: '边缘锐化：只锐化原图已有边缘。不新造细节，不重描轮廓，不改形状。' },
  { id: 'texture', label: '统一质感', hint: '均匀表面光影和质地，不换材质', instruction: '统一质感：轻微均匀表面光影和质地。不换材质，不改颜色。' },
]

/** 一键精修是面板的第一层入口；自定义方向仍保留在复选框里。 */
export const RETOUCH_PRESETS: ReadonlyArray<{
  id: string
  label: string
  description: string
  directions: readonly RetouchDirection[]
}> = [
  {
    id: 'standard',
    label: '一键精修',
    description: '去瑕疵 + 提亮',
    directions: ['blemish', 'brighten'],
  },
]

export const RETOUCH_TARGET_LONG_EDGE = { '1k': 1024, '2k': 2048, '4k': 4096 } as const

export type RetouchResolution = keyof typeof RETOUCH_TARGET_LONG_EDGE

/** 保持原尺寸时允许回写的最大像素数；与结果后处理的 sharp 输入上限一致。 */
export const RETOUCH_MAX_SOURCE_PIXELS = 40_000_000

/** 原图长边能覆盖的最小档位；超过 4096 仍用 4K，再由服务端放大回原尺寸。 */
export function retouchResolutionForSource(width: number, height: number): RetouchResolution {
  const longEdge = Math.max(1, Math.round(width), Math.round(height))
  if (longEdge <= RETOUCH_TARGET_LONG_EDGE['1k']) return '1k'
  if (longEdge <= RETOUCH_TARGET_LONG_EDGE['2k']) return '2k'
  return '4k'
}

/** 精修输出尺寸：按分辨率档位把原图缩放到对应长边，界面与实际请求共用这一份计算。 */
export function retouchOutputSize(
  width: number,
  height: number,
  resolution: RetouchResolution,
  keepSourceSize = false,
) {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  if (keepSourceSize) return { width: safeWidth, height: safeHeight }
  const scale = RETOUCH_TARGET_LONG_EDGE[resolution] / Math.max(safeWidth, safeHeight)
  return {
    width: Math.round(safeWidth * scale),
    height: Math.round(safeHeight * scale),
  }
}

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
export const RETOUCH_NOTE_MAX = promptLimit(
  RETOUCH_MODEL_PROMPT_MAX
  - retouchPromptParts([...RETOUCH_DIRECTION_IDS]).join('\n').length
  - RETOUCH_NOTE_PREFIX.length,
)

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

/** 历史任务与恢复参数里是否勾选了「保持原尺寸」；缺省视为否。 */
export function readKeepSourceSize(params: unknown) {
  return Boolean(params && typeof params === 'object'
    && (params as { keepSourceSize?: unknown }).keepSourceSize === true)
}

export function readRetouchDirections(params: unknown): RetouchDirection[] {
  if (!params || typeof params !== 'object' || !('retouchDirections' in params)) return []
  const value = (params as { retouchDirections?: unknown }).retouchDirections
  if (!Array.isArray(value)) return []
  return normalizeRetouchDirections(value.filter((item): item is string => typeof item === 'string'))
}
