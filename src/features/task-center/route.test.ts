import { describe, expect, it } from 'vitest'
import type { TaskCenterSummary } from '@shared/task-center'
import { taskDestination } from './route'
const sourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bridgeId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
describe('工作站桥接返回定位', () => {
  it('原工作站任务保留真实工具，并把不透明会话 ID 带回原入口', () => {
    const task={sourceKind:'image_job',sourceId,taskKey:`image_job:${sourceId}`,tool:'smart-edit',origin:{entry:'workstation',tool:'smart-edit',suiteBridgeId:bridgeId}} as TaskCenterSummary
    const destination=taskDestination(task)!
    expect(destination.startsWith('/image-workstation/smart-edit?')).toBe(true)
    const params=new URLSearchParams(destination.split('?')[1])
    expect(params.get('bridgeId')).toBe(bridgeId)
    expect(params.get('task')).toBe(task.taskKey)
    expect([...params.keys()].sort()).toEqual(['bridgeId','task'])
  })
  it('普通工作站任务沿用原路由，不附加其他项目身份', () => {
    expect(taskDestination({sourceKind:'image_job',taskKey:`image_job:${sourceId}`,tool:'smart-edit',origin:{entry:'workstation',tool:'smart-edit'}} as TaskCenterSummary))
      .toBe(`/image-workstation/smart-edit?task=image_job%3A${sourceId}`)
  })
})
