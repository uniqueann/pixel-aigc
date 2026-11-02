import { describe, expect, it, vi } from 'vitest'
import { CloudError } from '@/cloud/client'
import type { SuiteClient } from './api'
import { createSuiteProject } from './createProject'

const config = { baseAssetId: '00000000-0000-4000-8000-000000000001' } as never
const requestId = '00000000-0000-4000-8000-000000000002'
const project = { id: '00000000-0000-4000-8000-000000000003', config } as never

function fake(create: ReturnType<typeof vi.fn>, findCreate: ReturnType<typeof vi.fn>) {
  return { create, findCreate } as unknown as SuiteClient
}

const persister = () => vi.fn<(requestId: string) => Promise<void>>(async () => undefined)

describe('创建项目的幂等找回', () => {
  it('创建成功时直接返回，不额外查询', async () => {
    const create = vi.fn(async () => project), findCreate = vi.fn(async () => null), persist = persister()
    await expect(createSuiteProject(fake(create, findCreate), requestId, config, persist)).resolves.toEqual({ project, requestId, recovered: false })
    expect(create).toHaveBeenCalledWith(requestId, config)
    expect(findCreate).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('响应丢失但项目已创建时按原编号找回，不生成第二个项目', async () => {
    const create = vi.fn().mockRejectedValue(new Error('网络中断')), findCreate = vi.fn(async () => project), persist = persister()
    await expect(createSuiteProject(fake(create, findCreate), requestId, config, persist)).resolves.toEqual({ project, requestId, recovered: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(findCreate).toHaveBeenCalledWith(requestId)
    expect(persist).not.toHaveBeenCalled()
  })

  it('结果仍未知时保留原编号并上抛原错误，不冒险重复创建', async () => {
    const error = new Error('网络中断')
    const create = vi.fn().mockRejectedValue(error), findCreate = vi.fn(async () => null), persist = persister()
    await expect(createSuiteProject(fake(create, findCreate), requestId, config, persist)).rejects.toBe(error)
    expect(create).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
  })

  it('找回请求本身失败时同样保留原编号', async () => {
    const error = new Error('网络中断')
    const create = vi.fn().mockRejectedValue(error), findCreate = vi.fn().mockRejectedValue(new Error('仍然离线')), persist = persister()
    await expect(createSuiteProject(fake(create, findCreate), requestId, config, persist)).rejects.toBe(error)
    expect(persist).not.toHaveBeenCalled()
  })

  it('原项目已删除且找回为空时换新编号重试一次，并先持久化新编号', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new CloudError(409, '原恢复项目已删除', 'SUITE_PROJECT_DELETED'))
      .mockResolvedValueOnce(project)
    const findCreate = vi.fn(async () => null), persist = persister()
    const result = await createSuiteProject(fake(create, findCreate), requestId, config, persist)
    const next = persist.mock.calls[0][0]
    expect(next).not.toBe(requestId)
    expect(persist).toHaveBeenCalledWith(next)
    expect(create).toHaveBeenLastCalledWith(next, config)
    expect(result).toEqual({ project, requestId: next, recovered: false })
  })

  it('原编号已用于其他配置且旧行不可见时换新编号重试', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new CloudError(409, '创建请求已用于其他配置', 'SUITE_REQUEST_CONFLICT'))
      .mockResolvedValueOnce(project)
    const findCreate = vi.fn(async () => null), persist = persister()
    const result = await createSuiteProject(fake(create, findCreate), requestId, config, persist)
    expect(result.requestId).not.toBe(requestId)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('冲突但旧项目仍存在时转为找回，不换编号也不新建', async () => {
    const create = vi.fn().mockRejectedValue(new CloudError(409, '创建请求已用于其他配置', 'SUITE_REQUEST_CONFLICT'))
    const findCreate = vi.fn(async () => project), persist = persister()
    await expect(createSuiteProject(fake(create, findCreate), requestId, config, persist)).resolves.toEqual({ project, requestId, recovered: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
  })

  it('明确被拒绝的请求不查询也不换编号', async () => {
    const error = new CloudError(400, '参数无效', 'INVALID_PARAMS')
    const create = vi.fn().mockRejectedValue(error), findCreate = vi.fn(async () => null), persist = persister()
    await expect(createSuiteProject(fake(create, findCreate), requestId, config, persist)).rejects.toBe(error)
    expect(findCreate).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
