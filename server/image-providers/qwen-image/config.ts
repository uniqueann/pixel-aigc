export const QWEN_IMAGE_MODEL_IDS = ['qwen-image-3.0', 'qwen-image-3.0-pro'] as const

export const DEFAULT_QWEN_IMAGE_BASE_URL = 'https://dashscope.aliyuncs.com'
export const DEFAULT_QWEN_POLL_INTERVAL_MS = 3_000
export const DEFAULT_QWEN_INITIAL_POLL_DELAY_MS = 3_000
export const DEFAULT_QWEN_TASK_TIMEOUT_MS = 300_000
export const DEFAULT_QWEN_REQUEST_TIMEOUT_MS = 30_000
/** 俄勒冈到北京的建连有时超过共享百炼客户端的 4 秒。只给千问放宽。 */
export const DEFAULT_QWEN_CONNECT_TIMEOUT_MS = 10_000
export const DEFAULT_QWEN_MAX_PARALLEL = 1
/** 同一环境里进行中的百炼文生图任务。低于账号约 10 个异步任务的上限。 */
export const DEFAULT_QWEN_ACTIVE_LIMIT = 8
/** qwen-image-3.0-pro 约 5 RPM，单独再收紧。 */
export const DEFAULT_QWEN_PRO_ACTIVE_LIMIT = 4
const THROTTLE_BACKOFF_CAP_MS = 60_000

const ALLOWED_MODELS = new Set<string>(QWEN_IMAGE_MODEL_IDS)

export interface QwenImageSettings {
  apiKey: string
  baseUrl: string
  models: string[]
  promptExtend: boolean
  /**
   * 运维覆盖。未设置环境变量时为 undefined，由当次请求决定，默认关闭。
   * true / false 会盖过画布「自动扩写」。
   */
  thinkingOverride?: boolean
  requestTimeoutMs: number
  connectTimeoutMs: number
  retryCount: number
  pollIntervalMs: number
  initialPollDelayMs: number
  taskTimeoutMs: number
  maxParallel: number
}

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function readOptionalBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean) {
  const raw = env[name]?.trim().toLowerCase()
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return fallback
}

/** 只有 true/false/1/0 算显式覆盖。空值和其它写法都当作未设置。 */
function readTriStateBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name]?.trim().toLowerCase()
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return undefined
}

/**
 * 实际写入 DashScope `enable_thinking` 的值。
 * 优先级：prompt_extend 关闭（接口规定思考只在扩写打开时生效）>
 * `QWEN_IMAGE_THINKING` 显式 true/false >
 * 当次请求。请求缺省为 false。
 */
export function resolveQwenEnableThinking(
  settings: Pick<QwenImageSettings, 'promptExtend' | 'thinkingOverride'> | null | undefined,
  requested: boolean,
) {
  if (settings?.promptExtend === false) return false
  if (settings?.thinkingOverride !== undefined) return settings.thinkingOverride
  return requested
}

function httpsOrigin(raw: string | undefined) {
  const value = raw?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function parseQwenImageModels(raw: string | undefined) {
  if (!raw?.trim()) return [...QWEN_IMAGE_MODEL_IDS]
  const picked: string[] = []
  for (const part of raw.split(',')) {
    const model = part.trim()
    if (!ALLOWED_MODELS.has(model) || picked.includes(model)) continue
    picked.push(model)
  }
  return picked
}

/** 主开关。只有精确的 true 才打开，避免 DASHSCOPE_API_KEY 单独把文生图模型暴露出来。 */
export function qwenImageEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.QWEN_IMAGE_ENABLED?.trim() === 'true'
}

/**
 * 有百炼 Key 即可返回连接参数，不要求开关打开。
 * 已创建的任务在开关关闭后仍能查询；新任务是否列出由 qwenImageAvailable 决定。
 */
export function qwenImageSettings(env: NodeJS.ProcessEnv = process.env): QwenImageSettings | null {
  const apiKey = env.QWEN_IMAGE_API_KEY?.trim() || env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) return null
  const baseUrl = httpsOrigin(env.QWEN_IMAGE_BASE_URL)
    ?? httpsOrigin(env.DASHSCOPE_BASE_URL)
    ?? DEFAULT_QWEN_IMAGE_BASE_URL
  return {
    apiKey,
    baseUrl,
    models: parseQwenImageModels(env.QWEN_IMAGE_MODELS),
    promptExtend: readOptionalBoolean(env, 'QWEN_IMAGE_PROMPT_EXTEND', true),
    thinkingOverride: readTriStateBoolean(env, 'QWEN_IMAGE_THINKING'),
    requestTimeoutMs: readNumber(env, 'QWEN_IMAGE_REQUEST_TIMEOUT_MS', DEFAULT_QWEN_REQUEST_TIMEOUT_MS, 5_000, 120_000),
    connectTimeoutMs: readNumber(env, 'QWEN_IMAGE_CONNECT_TIMEOUT_MS', DEFAULT_QWEN_CONNECT_TIMEOUT_MS, 1_000, 30_000),
    retryCount: readNumber(env, 'QWEN_IMAGE_REQUEST_RETRY_COUNT', 2, 0, 5),
    pollIntervalMs: Math.max(3_000, readNumber(env, 'QWEN_IMAGE_POLL_INTERVAL_MS', DEFAULT_QWEN_POLL_INTERVAL_MS, 3_000, 30_000)),
    initialPollDelayMs: readNumber(env, 'QWEN_IMAGE_INITIAL_POLL_DELAY_MS', DEFAULT_QWEN_INITIAL_POLL_DELAY_MS, 0, 60_000),
    taskTimeoutMs: readNumber(env, 'QWEN_IMAGE_TASK_TIMEOUT_MS', DEFAULT_QWEN_TASK_TIMEOUT_MS, 30_000, 900_000),
    maxParallel: readNumber(env, 'QWEN_IMAGE_MAX_PARALLEL', DEFAULT_QWEN_MAX_PARALLEL, 1, 4),
  }
}

export function qwenImageAvailable(env: NodeJS.ProcessEnv = process.env) {
  const settings = qwenImageSettings(env)
  return qwenImageEnabled(env) && !!settings && settings.models.length > 0
}

export function qwenImageConcurrencyLimits(env: NodeJS.ProcessEnv = process.env) {
  return {
    providerActive: readNumber(env, 'QWEN_IMAGE_ACTIVE_LIMIT', DEFAULT_QWEN_ACTIVE_LIMIT, 1, 100),
    proActive: readNumber(env, 'QWEN_IMAGE_PRO_ACTIVE_LIMIT', DEFAULT_QWEN_PRO_ACTIVE_LIMIT, 1, 100),
  }
}

/**
 * 限流后的重新提交间隔。Pro 从 15 秒起，3.0 从 8 秒起，翻倍后封顶 60 秒，再加 0–50% 抖动。
 * 这样单任务不会按轮询间隔（3 秒）去撞 Pro 的 5 RPM。attempts 为已经失败的次数，从 1 起算。
 */
export function qwenThrottleBackoffMs(attempts: number, model?: string, random = Math.random) {
  const pro = model === 'qwen-image-3.0-pro' || model?.endsWith(':qwen-image-3.0-pro') === true
  const start = pro ? 15_000 : 8_000
  const exponent = Math.min(3, Math.max(0, Math.floor(attempts) - 1))
  const base = Math.min(THROTTLE_BACKOFF_CAP_MS, start * 2 ** exponent)
  const drawn = random()
  const unit = Number.isFinite(drawn) ? drawn : 0
  const jitter = Math.floor(base * 0.5 * Math.min(1, Math.max(0, unit)))
  return base + jitter
}

export type QwenForcedThrottle = 'rate' | 'quota'

/**
 * 只在能确认不是生产时生效。Production 的 VERCEL_ENV 或 AIGC_RUNTIME_SCOPE 都会关掉。
 * 两个都没设置时也不生效，避免误开。
 */
export function qwenForcedThrottle(env: NodeJS.ProcessEnv = process.env): QwenForcedThrottle | null {
  const raw = env.QWEN_IMAGE_FORCE_THROTTLE?.trim().toLowerCase()
  const mode: QwenForcedThrottle | null = raw === 'true' || raw === '1' || raw === 'rate' || raw === 'ratequota'
    ? 'rate'
    : raw === 'quota' || raw === 'allocation' || raw === 'allocationquota'
      ? 'quota'
      : null
  if (!mode || !qwenForceThrottleAllowed(env)) return null
  return mode
}

function qwenForceThrottleAllowed(env: NodeJS.ProcessEnv) {
  const vercel = env.VERCEL_ENV?.trim().toLowerCase()
  const scope = env.AIGC_RUNTIME_SCOPE?.trim().toLowerCase()
  if (vercel === 'production' || scope === 'production') return false
  if (vercel === 'preview' || vercel === 'development') return true
  if (!vercel && (scope === 'local' || scope === 'preview')) return true
  return false
}
