import { OPENROUTER_NANO_BANANA_MODEL } from '../../../shared/image-models.js'

export const DEFAULT_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1'
export const DEFAULT_AI_GATEWAY_REQUEST_TIMEOUT_MS = 70_000
export const DEFAULT_AI_GATEWAY_TASK_TIMEOUT_MS = 300_000
/**
 * 长于 Vercel 函数的 120 秒上限。提交还在同一次请求里生成时，另一次轮询不会再打一单。
 * 成功后会在同一次请求里把临时图收进正式结果，用户不用等这段延迟。
 */
export const DEFAULT_AI_GATEWAY_INITIAL_POLL_DELAY_MS = 130_000
export const DEFAULT_AI_GATEWAY_POLL_INTERVAL_MS = 2_000
export const DEFAULT_AI_GATEWAY_MAX_PARALLEL = 4
export const AI_GATEWAY_MAX_REFERENCE_IMAGES = 14

export interface AiGatewayImageSettings {
  /** 有 API Key 时优先使用。缺省表示请求时再取 Vercel OIDC。 */
  apiKey?: string
  baseUrl: string
  model: string
  requestTimeoutMs: number
  taskTimeoutMs: number
  pollIntervalMs: number
  initialPollDelayMs: number
  maxParallel: number
}

function readNumber(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number) {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function httpsBase(raw: string | undefined) {
  const value = raw?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return undefined
    const path = url.pathname.replace(/\/$/, '')
    return `${url.origin}${path === '/' ? '' : path}`
  } catch {
    return undefined
  }
}

/** 主开关。只有精确的 true 才打开，避免仅配置凭证就把模型露出来。 */
export function aiGatewayImageEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.AI_GATEWAY_IMAGE_ENABLED?.trim() === 'true'
}

function oidcFallbackAvailable(env: NodeJS.ProcessEnv) {
  return Boolean(env.VERCEL_OIDC_TOKEN?.trim()) || env.VERCEL === '1'
}

export function aiGatewayImageSettings(env: NodeJS.ProcessEnv = process.env): AiGatewayImageSettings | null {
  if (!aiGatewayImageEnabled(env)) return null
  const apiKey = env.AI_GATEWAY_API_KEY?.trim()
  if (!apiKey && !oidcFallbackAvailable(env)) return null
  return {
    ...(apiKey ? { apiKey } : {}),
    baseUrl: httpsBase(env.AI_GATEWAY_BASE_URL) ?? DEFAULT_AI_GATEWAY_BASE_URL,
    model: OPENROUTER_NANO_BANANA_MODEL,
    requestTimeoutMs: readNumber(env, 'AI_GATEWAY_IMAGE_REQUEST_TIMEOUT_MS', DEFAULT_AI_GATEWAY_REQUEST_TIMEOUT_MS, 5_000, 110_000),
    taskTimeoutMs: readNumber(env, 'AI_GATEWAY_IMAGE_TASK_TIMEOUT_MS', DEFAULT_AI_GATEWAY_TASK_TIMEOUT_MS, 30_000, 900_000),
    pollIntervalMs: Math.max(1_000, readNumber(env, 'AI_GATEWAY_IMAGE_POLL_INTERVAL_MS', DEFAULT_AI_GATEWAY_POLL_INTERVAL_MS, 1_000, 30_000)),
    initialPollDelayMs: readNumber(env, 'AI_GATEWAY_IMAGE_INITIAL_POLL_DELAY_MS', DEFAULT_AI_GATEWAY_INITIAL_POLL_DELAY_MS, 0, 300_000),
    maxParallel: readNumber(env, 'AI_GATEWAY_IMAGE_MAX_PARALLEL', DEFAULT_AI_GATEWAY_MAX_PARALLEL, 1, 4),
  }
}

export function aiGatewayImageAvailable(env: NodeJS.ProcessEnv = process.env) {
  return aiGatewayImageSettings(env) !== null
}
