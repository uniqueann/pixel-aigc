// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/cloud/client', () => ({
  authEnabled: true,
  cloudConfigurationError: '请先配置 Supabase URL 和 publishable key，再启用账号系统',
  supabase: null,
}))

import AuthPages from './AuthPages'

describe('账号页配置错误', () => {
  it('复用认证页模板展示配置错误', () => {
    render(<AuthPages />)
    expect(screen.getByRole('img', { name: 'Pixel AIGC' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '账号系统不可用' })).toBeTruthy()
    expect(screen.getByText('请先配置 Supabase URL 和 publishable key，再启用账号系统')).toBeTruthy()
    expect(screen.getByRole('link', { name: '产品介绍' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '隐私政策' })).toBeTruthy()
  })
})
