/** 提示词、描述类输入框的统一字数上限。模型真实上限更低时不要用这个值。 */
export const PROMPT_MAX_LENGTH = 3500

/**
 * 万相 wanx2.1-imageedit 的 `input.prompt` 上限。
 * 文档写明最大 800 字符，超出部分会被截断。消除、局部重绘、扩图共用该模型。
 */
export const BAILIAN_IMAGEEDIT_PROMPT_MAX = 800

/**
 * 火山方舟 Seedance 文生视频 / 图生视频。
 * 官方把中文约 500 字、英文约 1000 词写成效果建议，并说明这不是接口硬性字数上限；
 * 没有公布低于 {@link PROMPT_MAX_LENGTH} 的拒绝阈值。本应用原先允许 4000。
 */
export const VIDEO_PROMPT_MAX = PROMPT_MAX_LENGTH

/** 取统一上限与模型剩余预算中更小的那个，避免拼进固定句后超出模型。 */
export function promptLimit(modelMax: number) {
  if (!Number.isFinite(modelMax)) return 0
  return Math.min(PROMPT_MAX_LENGTH, Math.max(0, Math.floor(modelMax)))
}
