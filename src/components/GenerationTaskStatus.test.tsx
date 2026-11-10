// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
  it('结果不可读时隐藏完成态，也不重复给出结论或重试入口', () => {
    render(
      <GenerationTaskStatus
        task={succeededTask}
        resultUnavailable
        historySaved
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('结果暂时无法读取')).toBeNull()
    expect(screen.queryByText('生成完成')).toBeNull()
    expect(screen.queryByText('完整图片已保存到本地历史')).toBeNull()
    expect(screen.queryByRole('button', { name: '重试读取' })).toBeNull()
  })

  it('结果可读时保持正常的生成完成状态', () => {
    render(<GenerationTaskStatus task={succeededTask} summary="已生成 1 个图片结果" />)
    expect(screen.getByText('生成完成')).toBeTruthy()
    expect(screen.getByText('已生成 1 个图片结果')).toBeTruthy()
    expect(screen.queryByText('结果暂时无法读取')).toBeNull()
  })
})
