/** 图片业务上限与 JSON 传输预算分别约束，合法大图优先直传对象存储。 */

/** 单张图片的业务上限，与界面承诺一致。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Vercel 平台请求体预算，超出时请求可能无法进入函数。 */
export const PLATFORM_BODY_BYTES = 4_500_000

/** task-inputs/fallback 的服务端请求体上限，前后端共同使用。 */
export const TASK_INPUT_FALLBACK_BODY_BYTES = 3 * 1024 * 1024

/** JSON 字段名与对象键等开销的保守预留。 */
export const JSON_BODY_OVERHEAD_BYTES = 64 * 1024

/** base64 编码后的体积（4/3 向上取整）。 */
export function base64Length(bytes: number) {
  return 4 * Math.ceil(bytes / 3)
}

export function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

export const IMAGE_TOO_LARGE_MESSAGE = `图片大小不能超过 ${formatMegabytes(MAX_IMAGE_BYTES)}`

/** 备用请求同时受平台和服务端限制，不能只按平台预算放行。 */
export function base64FitsTaskInputFallback(bodyBytes: number) {
  return base64Length(bodyBytes) + JSON_BODY_OVERHEAD_BYTES
    <= Math.min(PLATFORM_BODY_BYTES, TASK_INPUT_FALLBACK_BODY_BYTES)
}

/** 此时原图未超业务上限，失败起点是直传异常。 */
export const FALLBACK_TOO_LARGE_MESSAGE = '原图直传失败，当前图片无法通过备用通道上传，请重试；仍失败可压缩后重试'

export const REQUEST_TOO_LARGE_MESSAGE = '图片太大，提交的内容超出了服务上限，请压缩图片后重试'

/** 保留服务端具体文案，仅转换空响应或通用英文 413。 */
export function uploadFailureText(message: string | undefined, status?: number) {
  const text = message?.trim() || undefined
  const platformText = Boolean(text && /request entity too large|payload too large|request failed with status code 413/i.test(text))
  if (platformText) return REQUEST_TOO_LARGE_MESSAGE
  if (!text && status === 413) return REQUEST_TOO_LARGE_MESSAGE
  return text
}
