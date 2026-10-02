// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FusionInputStatus from './FusionInputStatus'

afterEach(cleanup)
describe('融合输入状态', () => {
  it('单图失败时另一图显示上传中，全部结束后才能重试', () => {
    const retry = vi.fn()
    const cancel = vi.fn()
    const failed = { stage: 'failed' as const, error: '场景上传断开' }
    const { rerender } = render(<FusionInputStatus state={{ phase: 'preparing', product: { stage: 'uploading' }, reference: failed }} onRetry={retry} onCancel={cancel} onModify={vi.fn()} />)
    expect(screen.getByText('商品图：正在上传')).toBeTruthy()
    expect(screen.getByText('场景上传断开')).toBeTruthy()
    const button = screen.getByRole('button', { name: '重试失败图片并提交' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消准备' }))
    expect(cancel).toHaveBeenCalledOnce()
    rerender(<FusionInputStatus state={{ phase: 'failed', product: { stage: 'ready' }, reference: failed }} onRetry={retry} onCancel={cancel} onModify={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '重试失败图片并提交' }))
    expect(retry).toHaveBeenCalledOnce()
  })
  it('生成请求开始后没有取消准备或输入重试入口', () => {
    render(<FusionInputStatus state={{ phase: 'submitting', product: { stage: 'ready' }, reference: { stage: 'ready' } }} onRetry={vi.fn()} onCancel={vi.fn()} onModify={vi.fn()} />)
    expect(screen.getByText('正在提交融合任务')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
