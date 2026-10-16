import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_INITIAL_POLL_DELAY_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  SOURCE_PRESIGN_TTL_SECONDS,
  dragonCodeConfig,
} from './config.js'

describe('DragonCode 轮询默认值', () => {
  const previous = process.env.DRAGONCODE_API_KEY

  afterEach(() => {
    if (previous === undefined) delete process.env.DRAGONCODE_API_KEY
    else process.env.DRAGONCODE_API_KEY = previous
    delete process.env.DRAGONCODE_INITIAL_POLL_DELAY_MS
    delete process.env.DRAGONCODE_POLL_INTERVAL_MS
    delete process.env.DRAGONCODE_TASK_TIMEOUT_MS
  })

  it('首次轮询 5s、后续间隔 3s、超时 ≥180s，预签名 TTL ≥15min', () => {
    process.env.DRAGONCODE_API_KEY = 'test-key'
    const config = dragonCodeConfig()
    expect(DEFAULT_INITIAL_POLL_DELAY_MS).toBe(5_000)
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(3_000)
    expect(DEFAULT_TASK_TIMEOUT_MS).toBe(300_000)
    expect(SOURCE_PRESIGN_TTL_SECONDS).toBeGreaterThanOrEqual(15 * 60)
    expect(config).toMatchObject({
      initialPollDelayMs: 5_000,
      pollIntervalMs: 3_000,
      taskTimeoutMs: 300_000,
    })
    expect(config!.taskTimeoutMs).toBeGreaterThanOrEqual(180_000)
  })
  it('显式配置较慢间隔时保留配置，过低值仍限制为 3s', () => {
    expect(dragonCodeConfig({ DRAGONCODE_API_KEY: 'test', DRAGONCODE_POLL_INTERVAL_MS: '8000' })?.pollIntervalMs).toBe(8_000)
    expect(dragonCodeConfig({ DRAGONCODE_API_KEY: 'test', DRAGONCODE_POLL_INTERVAL_MS: '1000' })?.pollIntervalMs).toBe(3_000)
  })
})
