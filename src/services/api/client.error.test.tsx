// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'

vi.mock('@/cloud/client', () => ({ authEnabled: false, supabase: null }))
import { apiClient } from './client'

function fail(status: number, data: unknown) {
  return (config: InternalAxiosRequestConfig) => {
    const response = { data, status, statusText: 'Error', headers: {}, config }
    return Promise.reject(new AxiosError(
      `Request failed with status code ${status}`,
      status >= 400 && status < 500 ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
      config,
      undefined,
      response,
    ))
  }
}

async function rejected(status: number, data: unknown) {
  return apiClient.post('/tasks', { requestId: 'display-only' }, { adapter: fail(status, data) }).then(
    () => { throw new Error('应当拒绝') },
    error => error,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('接口失败文案', () => {
  it('对象错误的字符串 message 进入提交失败提示，不带出其余字段', async () => {
    const error = await rejected(400, {
      error: { message: '原图对象无效', code: 'INVALID_SOURCE', token: 'secret-token' },
    })
    expect(error).toMatchObject({
      name: 'ApiError',
      message: '原图对象无效',
      status: 400,
      code: 'INVALID_SOURCE',
    })
    render(<GenerationTaskStatus submissionError={(error as Error).message} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('提交失败')
    expect(alert.textContent).toContain('原图对象无效')
    expect(alert.textContent).not.toMatch(/object Object|secret-token/)
  })

  it('没有可用 message 的 413 不展示平台英文原文', async () => {
    const error = await rejected(413, {
      error: { token: 'secret-token', detail: { authorization: 'Bearer secret' } },
    })
    expect(error).toMatchObject({
      status: 413,
      message: '图片太大，提交的内容超出了服务上限，请压缩图片后重试',
    })
    expect(String((error as Error).message)).not.toMatch(/object Object|secret|Request Entity Too Large/i)
  })

  it('保留服务端字符串错误和错误码', async () => {
    const error = await rejected(413, { error: '请求内容过大', code: 'REQUEST_FAILED' })
    expect(error).toMatchObject({
      message: '请求内容过大',
      status: 413,
      code: 'REQUEST_FAILED',
    })
  })

  it('空响应、空白 error 和缺失响应体都退回状态句', async () => {
    const empty = await rejected(413, '')
    const blank = await rejected(502, { error: '   ' })
    const missing = await rejected(500, null)
    // 413 是唯一会被换成中文结论的状态，其余仍保留状态句。
    expect(empty).toMatchObject({ status: 413, message: '图片太大，提交的内容超出了服务上限，请压缩图片后重试' })
    expect(blank).toMatchObject({ status: 502, message: 'Request failed with status code 502' })
    expect(missing).toMatchObject({ status: 500, message: 'Request failed with status code 500' })
  })

  it('402 仍派发充值事件，并使用嵌套句子', async () => {
    const onRecharge = vi.fn()
    window.addEventListener('aigc:recharge', onRecharge)
    try {
      const error = await rejected(402, {
        error: { message: '积分不足' },
        code: 'INSUFFICIENT_CREDITS',
      })
      expect(error).toMatchObject({
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        message: '积分不足',
      })
      expect(onRecharge).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('aigc:recharge', onRecharge)
    }
  })

  it('非 402 的字符串错误不派发充值事件', async () => {
    const onRecharge = vi.fn()
    window.addEventListener('aigc:recharge', onRecharge)
    try {
      await rejected(400, { error: '请求参数无效', code: 'INVALID_REQUEST' })
      expect(onRecharge).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('aigc:recharge', onRecharge)
    }
  })
})
