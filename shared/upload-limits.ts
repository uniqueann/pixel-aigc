/**
 * 图片上传的体积预算与超限文案。
 *
 * 背景：`Request Entity Too Large` 是 Vercel 平台层在请求进入函数之前返回的原文，
 * 说明请求体已经超过了平台上限。这一层无法用业务文案替代，只能在发出请求前避开它。
 *
 * 三条链路的上限互不相同，必须分别约束：
 * 1. 平台请求体上限（PLATFORM_BODY_BYTES）：所有走 /api 的 JSON 请求都受它约束。
 * 2. 业务上限（MAX_IMAGE_BYTES）：产品对用户承诺的单张图片上限。
 * 3. 直传（PUT 到签名地址）不经过平台，因此大图必须走这里。
 */

/** 单张图片的业务上限，与界面承诺一致。 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * Vercel 平台对单个请求体的上限（4.5 MB）。
 * 超过它请求根本进不到函数，拿到的是平台英文原文而不是我们的 413 文案。
 */
export const PLATFORM_BODY_BYTES = 4_500_000

/** JSON 请求体里除图片数据外的固定开销：字段名、prompt、timing 等。 */
export const JSON_BODY_OVERHEAD_BYTES = 64 * 1024

/** base64 编码后的体积（4/3 向上取整）。 */
export function base64Length(bytes: number) {
  return 4 * Math.ceil(bytes / 3)
}

export function formatMegabytes(bytes: number) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** 超过业务上限时给用户看的唯一文案。 */
export const IMAGE_TOO_LARGE_MESSAGE = `图片大小不能超过 ${formatMegabytes(MAX_IMAGE_BYTES)}`

/**
 * 回退链路的可用预算：base64 后仍要装进平台请求体。
 * 直传失败时才会走到这里，因此这里必须比业务上限严格得多。
 */
export function base64FitsPlatform(bodyBytes: number) {
  return base64Length(bodyBytes) + JSON_BODY_OVERHEAD_BYTES <= PLATFORM_BODY_BYTES
}

/**
 * 回退装不下时的文案：说清是体积原因、并给出可做的事。
 * 不写「请检查网络」——这是体积问题，让用户去查网络是把人引向错误方向。
 */
export const FALLBACK_TOO_LARGE_MESSAGE = '图片太大，无法通过备用通道上传，请压缩后重试'

/**
 * 平台层 413 的统一结论。
 * 它意味着请求体在到达服务前就被拒了，所以给用户的方向是换小一点的图，而不是重试网络。
 */
export const REQUEST_TOO_LARGE_MESSAGE = '图片太大，提交的内容超出了服务上限，请压缩图片后重试'

/**
 * 把平台层的英文 413 原文换成可操作的中文结论。
 *
 * 只在“拿不到业务文案”时生效：服务端自己的 413（如“请求内容过大”“图片大小不能超过 20 MB”）
 * 已经是具体结论，必须原样保留；只有空响应或平台英文原文才需要翻译。
 */
export function uploadFailureText(message: string | undefined, status?: number) {
  const text = message?.trim() || undefined
  const platformText = Boolean(text && /request entity too large|payload too large|request failed with status code 413/i.test(text))
  if (platformText) return REQUEST_TOO_LARGE_MESSAGE
  if (!text && status === 413) return REQUEST_TOO_LARGE_MESSAGE
  return text
}
