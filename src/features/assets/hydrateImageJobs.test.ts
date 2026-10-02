import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask } from '@/types'

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  blobFromImageSource: vi.fn(),
  readOwnedImage: vi.fn(),
  listHistoryDeletions: vi.fn(),
  listWorkstationHistory: vi.fn(),
  recordWorkstationHistory: vi.fn(),
  isCurrentOwner: vi.fn(),
}))

const OWNER = '11111111-1111-4111-8111-111111111111'

vi.mock('@/services/api/task', () => ({
  listTasks: mocks.listTasks,
  getTask: mocks.getTask,
}))
vi.mock('@/services/api/ownedImages', () => ({ readOwnedImage: mocks.readOwnedImage }))
vi.mock('@/features/image-workstation/download', () => ({
  blobFromImageSource: mocks.blobFromImageSource,
}))
vi.mock('./workstationHistory', () => ({
  listHistoryMetadata: mocks.listWorkstationHistory,
  listHistoryDeletions: mocks.listHistoryDeletions,
  associateHistoryResult: vi.fn(),
  HISTORY_LIMIT: 50,
  compareHistory: (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  recordWorkstationHistory: mocks.recordWorkstationHistory,
}))
vi.mock('./historyOwner', () => ({ isCurrentWorkstationHistoryOwner: mocks.isCurrentOwner, currentWorkstationHistoryOwner: () => '11111111-1111-4111-8111-111111111111' }))

import { historyRecordsFromImageTask, hydrateWorkstationHistoryFromImageJobs, metadataFromImageTask } from './hydrateImageJobs'

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
    mocks.listHistoryDeletions.mockReset().mockResolvedValue([])
    mocks.readOwnedImage.mockReset().mockResolvedValue(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }))
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
    expect(mocks.readOwnedImage).toHaveBeenCalledWith(expect.objectContaining({ objectKey: 'generated/user/job/0.png' }), expect.objectContaining({ ownerId: OWNER }))
  })

  it('文生图保留实际结果序号和用户提示词，不依赖工作站工具', () => {
    const task = { ...variationTask, capability: Capability.TextToImage, params: { prompt: '  夜晚的城市  ' },
      resultImages: [{ ...variationTask.resultImages![0], ordinal: 2 }],
    }
    expect(metadataFromImageTask(task)).toEqual([expect.objectContaining({
      id: `${task.id}:o2`, ordinal: 2, toolSlug: 'text-to-image', capability: Capability.TextToImage, prompt: '夜晚的城市',
    })])
  })

  it('跨设备补记文生图时只读取缺失结果，已删除对象和稳定序号不会复活或重复', async () => {
    const task = { ...variationTask, capability: Capability.TextToImage,
      resultImages: [0, 2].map(ordinal => ({ ...variationTask.resultImages![0], objectKey: `text-image-${ordinal}`, ordinal })),
    }
    const local: Array<{ id: string; objectKey: string; taskId: string; createdAt: string }> = []
    mocks.listWorkstationHistory.mockImplementation(async () => local)
    mocks.listHistoryDeletions.mockResolvedValue([{ id: `${task.id}:o0`, taskId: task.id, objectKey: 'text-image-0' }])
    mocks.listTasks.mockImplementation(async ({ capability }: { capability: Capability }) => ({
      items: capability === Capability.TextToImage ? [{ id: task.id, capability, status: 'succeeded', updatedAt: task.updatedAt }] : [],
      total: capability === Capability.TextToImage ? 1 : 0,
    }))
    mocks.getTask.mockResolvedValue(task)
    mocks.recordWorkstationHistory.mockImplementation(async (_owner, record) => { local.push(record) })
    await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(mocks.listTasks).toHaveBeenCalledWith({ capability: Capability.TextToImage, page: 1 })
    expect(mocks.readOwnedImage.mock.calls.map(([image]) => image.objectKey)).toEqual(['text-image-2'])
    expect(mocks.recordWorkstationHistory).toHaveBeenCalledWith(OWNER, expect.objectContaining({ id: `${task.id}:o2`, toolSlug: 'text-to-image' }))
    await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(mocks.readOwnedImage).toHaveBeenCalledTimes(1)
    expect(mocks.recordWorkstationHistory).toHaveBeenCalledTimes(1)
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
  it('四张只缺两张时仅补缺失项，部分读取失败不丢其他结果', async () => {
    const task = { ...variationTask, resultImages: Array.from({ length: 4 }, (_, ordinal) => ({ ...variationTask.resultImages![0], objectKey: `k${ordinal}`, ordinal })) }
    mocks.listWorkstationHistory.mockResolvedValue([0, 2].map(ordinal => ({ id: `${task.id}:o${ordinal}`, objectKey: `k${ordinal}`, taskId: task.id, createdAt: task.createdAt })))
    mocks.listTasks.mockResolvedValue({ items: [{ ...task }], total: 1 })
    mocks.getTask.mockResolvedValue(task)
    mocks.readOwnedImage.mockImplementation(async ({ objectKey }: { objectKey: string }) => { if (objectKey === 'k1') throw new Error('网络中断'); return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }) })
    const result = await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(result.failed).toBe(1)
    expect(mocks.readOwnedImage.mock.calls.map(([image]) => image.objectKey)).toEqual(['k1', 'k3'])
    expect(mocks.recordWorkstationHistory).toHaveBeenCalledWith(OWNER, expect.objectContaining({ id: `${task.id}:o3` }))
    expect(mocks.getTask).toHaveBeenCalledTimes(1)
  })
  it('分页先选最近 50 张，反复补记不读被淘汰的旧图，删除对象不复活', async () => {
    const tasks = Array.from({ length: 60 }, (_, i) => ({ ...variationTask, id: `task-${i}`, createdAt: new Date(Date.UTC(2026, 8, 30, 0, 60 - i)).toISOString(), resultImages: [{ ...variationTask.resultImages![0], ordinal: 0, objectKey: `key-${i}` }] }))
    const local: Array<{ id: string; objectKey: string; taskId: string; createdAt: string }> = []
    mocks.listWorkstationHistory.mockImplementation(async () => local)
    mocks.listHistoryDeletions.mockResolvedValue([{ id: 'task-0:o0', objectKey: 'key-0', taskId: 'task-0' }])
    mocks.listTasks.mockImplementation(async ({ page }: { page: number }) => ({ items: tasks.slice((page - 1) * 20, page * 20), total: 60 }))
    mocks.getTask.mockImplementation(async (id: string) => tasks.find(task => task.id === id))
    mocks.recordWorkstationHistory.mockImplementation(async (_owner, record) => { local.push(record) })
    await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(mocks.readOwnedImage).toHaveBeenCalledTimes(50)
    expect(mocks.readOwnedImage.mock.calls.map(([item]) => item.objectKey)).not.toContain('key-0')
    expect(mocks.readOwnedImage.mock.calls.map(([item]) => item.objectKey)).not.toContain('key-51')
    await hydrateWorkstationHistoryFromImageJobs(OWNER)
    expect(mocks.readOwnedImage).toHaveBeenCalledTimes(50)
  })
  it('稳定序号不因第一项失败或晚到而改变', async () => {
    const first = await historyRecordsFromImageTask({ ...variationTask, resultImages: [{ ...variationTask.resultImages![0], ordinal: 2 }] })
    const late = await historyRecordsFromImageTask({ ...variationTask, resultImages: [{ ...variationTask.resultImages![0], ordinal: 0 }, { ...variationTask.resultImages![0], ordinal: 2 }] })
    expect(first[0].id).toBe(`${variationTask.id}:o2`)
    expect(late[1].id).toBe(first[0].id)
  })

})
