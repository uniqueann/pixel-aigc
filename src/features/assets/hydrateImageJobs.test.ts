import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask } from '@/types'

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  blobFromImageSource: vi.fn(),
  listWorkstationHistory: vi.fn(),
  recordWorkstationHistory: vi.fn(),
  isCurrentOwner: vi.fn(),
}))

const OWNER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/services/api/task', () => ({
  listTasks: mocks.listTasks,
  getTask: mocks.getTask,
}))
vi.mock('@/features/image-workstation/download', () => ({
  blobFromImageSource: mocks.blobFromImageSource,
}))
vi.mock('./workstationHistory', () => ({
  listWorkstationHistory: mocks.listWorkstationHistory,
  recordWorkstationHistory: mocks.recordWorkstationHistory,
}))
vi.mock('./historyOwner', () => ({ isCurrentWorkstationHistoryOwner: mocks.isCurrentOwner }))

import { historyRecordsFromImageTask, hydrateWorkstationHistoryFromImageJobs } from './hydrateImageJobs'

const variationTask: GenerationTask = {
  id: '11111111-1111-4111-8111-111111111111',
  capability: Capability.Variation,
  status: 'succeeded',
  params: { prompt: '暖色晨光' },
  resultImages: [{
    url: 'https://r2.example/generated/a.png',
    objectKey: 'generated/user/job/0.png',
    width: 2048,
    height: 2048,
    mimeType: 'image/png',
  }],
  creditsCost: 2,
  createdAt: '2026-09-28T15:00:00.000Z',
  updatedAt: '2026-09-28T15:01:00.000Z',
}

describe('从图片任务补记我的资产', () => {
  beforeEach(() => {
    mocks.listTasks.mockReset()
    mocks.getTask.mockReset()
    mocks.blobFromImageSource.mockReset()
    mocks.listWorkstationHistory.mockReset()
    mocks.recordWorkstationHistory.mockReset()
    mocks.isCurrentOwner.mockReset()
    mocks.isCurrentOwner.mockReturnValue(true)
    mocks.blobFromImageSource.mockResolvedValue(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }))
    mocks.listWorkstationHistory.mockResolvedValue([])
    mocks.recordWorkstationHistory.mockResolvedValue(undefined)
  })

  it('重新打光记成重新打光，说明用光效名称', async () => {
    const records = await historyRecordsFromImageTask({
      ...variationTask,
      id: '44444444-4444-4444-8444-444444444444',
      capability: Capability.ImageEdit,
      params: {
        relight: { direction: 'left', quality: 'soft', temperature: 'warm' },
        prompt: '略提亮背景',
      },
    })
    expect(records[0]).toMatchObject({
      toolSlug: 'relight',
      capability: Capability.ImageEdit,
      prompt: '左侧、柔光、暖色。略提亮背景',
    })
  })

  it('融合记成融合，说明只保留用户补充', async () => {
    const records = await historyRecordsFromImageTask({
      ...variationTask,
      id: '33333333-3333-4333-8333-333333333333',
      capability: Capability.ImageEdit,
      params: { referenceImageKey: 'temporary/task-inputs/user/scene', prompt: '放在桌面中央' },
    })
    expect(records[0]).toMatchObject({
      toolSlug: 'fusion',
      capability: Capability.ImageEdit,
      prompt: '放在桌面中央',
    })
  })

  it('精修按方向记成精修，不把固定句写进资产说明', async () => {
    const records = await historyRecordsFromImageTask({
      ...variationTask,
      id: '22222222-2222-4222-8222-222222222222',
      capability: Capability.ImageEdit,
      params: { retouchDirections: ['sharpen', 'blemish'], prompt: '保留吊牌' },
    })
    expect(records[0]).toMatchObject({
      toolSlug: 'retouch',
      capability: Capability.ImageEdit,
      prompt: '去瑕疵、边缘锐化。保留吊牌',
    })
  })

  it('裂变和智能编辑都写成对应中文工具名的历史记录', async () => {
    const records = await historyRecordsFromImageTask(variationTask)
    expect(records).toEqual([expect.objectContaining({
      id: `${variationTask.id}:0`,
      toolSlug: 'variation',
      capability: Capability.Variation,
      prompt: '暖色晨光',
      width: 2048,
      height: 2048,
    })])
    expect(mocks.blobFromImageSource).toHaveBeenCalledWith(
      'https://r2.example/generated/a.png',
      'generated/user/job/0.png',
    )
  })

  it('已有本地记录时不再重复拉取', async () => {
    mocks.listWorkstationHistory.mockResolvedValue([{ id: `${variationTask.id}:0` }])
    mocks.listTasks.mockImplementation(async ({ capability }: { capability: Capability }) => ({
      items: capability === Capability.Variation
        ? [{ id: variationTask.id, capability, status: 'succeeded' }]
        : [],
      total: capability === Capability.Variation ? 1 : 0,
    }))
    await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(mocks.getTask).not.toHaveBeenCalled()
    expect(mocks.recordWorkstationHistory).not.toHaveBeenCalled()
  })

  it('补记尚未写入本地的裂变结果', async () => {
    mocks.listTasks.mockImplementation(async ({ capability }: { capability: Capability }) => ({
      items: capability === Capability.Variation
        ? [{ id: variationTask.id, capability, status: 'succeeded' }]
        : [],
      total: capability === Capability.Variation ? 1 : 0,
    }))
    mocks.getTask.mockResolvedValue(variationTask)
    await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(mocks.recordWorkstationHistory).toHaveBeenCalledWith(OWNER, expect.objectContaining({
      id: `${variationTask.id}:0`,
      toolSlug: 'variation',
    }))
  })

  it('拉取中切换账号时停止补记', async () => {
    mocks.listTasks.mockImplementation(async () => {
      mocks.isCurrentOwner.mockReturnValue(false)
      return { items: [{ id: variationTask.id, status: 'succeeded' }], total: 1 }
    })
    await expect(hydrateWorkstationHistoryFromImageJobs(OWNER)).rejects.toThrow('账号已切换')
    expect(mocks.recordWorkstationHistory).not.toHaveBeenCalled()
  })
})
