// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask } from '@/types'
import GenerationTaskStatus from './GenerationTaskStatus'

const succeededTask = {
  id: 'task-result',
  capability: Capability.ImageEdit,
  status: 'succeeded',
  params: {},
  result: {},
  creditsCost: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as GenerationTask

afterEach(cleanup)

describe('生成任务状态', () => {
  it('结果读取失败时只保留一个警告结论和免费重试入口', () => {
    const retryRead = vi.fn()
    render(
      <GenerationTaskStatus
        task={succeededTask}
        resultReadError="仅支持 PNG、JPEG 和 WebP 图片"
        historySaved
        onRetryRead={retryRead}
      />,
    )
    expect(screen.queryByText('生成完成')).toBeNull()
    expect(screen.queryByText('完整图片已保存到本地历史')).toBeNull()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('结果暂时无法读取')
    expect(alert.textContent).toContain('可免费重试，不会重复扣费')
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    expect(retryRead).toHaveBeenCalledTimes(1)
  })

  it('结果可读时保持正常的生成完成状态', () => {
    render(<GenerationTaskStatus task={succeededTask} summary="已生成 1 个图片结果" />)
    expect(screen.getByText('生成完成')).toBeTruthy()
    expect(screen.getByText('已生成 1 个图片结果')).toBeTruthy()
    expect(screen.queryByText('结果暂时无法读取')).toBeNull()
  })
})
