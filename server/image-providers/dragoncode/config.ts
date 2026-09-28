export const DEFAULT_DRAGONCODE_BASE_URL = 'https://dragoncode.codes/gpt-image/v1'
export const DEFAULT_DRAGONCODE_MODEL = 'gpt-image-2'

export interface DragonCodeConfig {
  apiKey: string
  baseUrl: string
  model: string
  requestTimeoutMs: number
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

export function dragonCodeConfig(env: NodeJS.ProcessEnv = process.env): DragonCodeConfig | null {
  const apiKey = env.DRAGONCODE_API_KEY?.trim()
  if (!apiKey) return null
  const timeoutMs = readNumber(
    env,
    'DRAGONCODE_TASK_TIMEOUT_MS',
    readNumber(env, 'DRAGONCODE_RESTORE_TIMEOUT_MS', 300_000, 30_000, 900_000),
    30_000,
    900_000,
  )
  return {
    apiKey,
    baseUrl: (env.DRAGONCODE_BASE_URL?.trim() || DEFAULT_DRAGONCODE_BASE_URL).replace(/\/$/, ''),
    model: env.DRAGONCODE_IMAGE_MODEL?.trim() || DEFAULT_DRAGONCODE_MODEL,
    requestTimeoutMs: readNumber(env, 'DRAGONCODE_REQUEST_TIMEOUT_MS', 30_000, 5_000, 120_000),
    retryCount: readNumber(env, 'DRAGONCODE_REQUEST_RETRY_COUNT', 2, 0, 5),
    pollIntervalMs: Math.max(3_000, readNumber(env, 'DRAGONCODE_POLL_INTERVAL_MS', 5_000, 3_000, 30_000)),
    initialPollDelayMs: readNumber(env, 'DRAGONCODE_INITIAL_POLL_DELAY_MS', 10_000, 0, 60_000),
    taskTimeoutMs: timeoutMs,
    maxParallel: readNumber(env, 'DRAGONCODE_MAX_PARALLEL', 4, 1, 8),
  }
}

export function isDragonCodeConfigured(env: NodeJS.ProcessEnv = process.env) {
  return dragonCodeConfig(env) !== null
}
