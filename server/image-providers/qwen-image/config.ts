export const QWEN_IMAGE_MODEL_IDS = ['qwen-image-3.0', 'qwen-image-3.0-pro'] as const

export const DEFAULT_QWEN_IMAGE_BASE_URL = 'https://dashscope.aliyuncs.com'
export const DEFAULT_QWEN_POLL_INTERVAL_MS = 3_000
export const DEFAULT_QWEN_INITIAL_POLL_DELAY_MS = 3_000
export const DEFAULT_QWEN_TASK_TIMEOUT_MS = 300_000
export const DEFAULT_QWEN_REQUEST_TIMEOUT_MS = 30_000
/** 俄勒冈到北京的建连有时超过共享百炼客户端的 4 秒。只给千问放宽。 */
export const DEFAULT_QWEN_CONNECT_TIMEOUT_MS = 10_000
export const DEFAULT_QWEN_MAX_PARALLEL = 1

const ALLOWED_MODELS = new Set<string>(QWEN_IMAGE_MODEL_IDS)

export interface QwenImageSettings {
  apiKey: string
  baseUrl: string
  models: string[]
  promptExtend: boolean
  enableThinking: boolean
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
    enableThinking: readOptionalBoolean(env, 'QWEN_IMAGE_THINKING', true),
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
