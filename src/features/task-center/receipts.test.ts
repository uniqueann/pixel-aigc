// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import {readWorkstationSession,saveWorkstationSession} from './workstationSession'
import {
  readReceipts,
  saveReceipt,
  submittedReceipt,
  TASK_CENTER_EVENT,
} from './receipts'
const owner = '00000000-0000-4000-8000-000000000081',
  actor = { owner, scope: 'preview' as const }
const id = (i: number) =>
  `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
beforeEach(() => {
  localStorage.clear()
  useUserStore.getState().setAccount({
    userId: owner,
    runtimeScope: 'preview',
    features: { taskCenter: true },
  } as AccountContext)
})
afterEach(() => {
  vi.restoreAllMocks()
  useUserStore.getState().setAccount(null)
})
describe('最小提交凭据', () => {
  it('按账号环境隔离，去重最多50项，7天到期', () => {
    for (let i = 0; i < 55; i++)
      saveReceipt('sync_credit', id(i), { entry: 'toolbox', tool: 'bg-remove' })
    const receipt = saveReceipt('sync_credit', id(54), {
      entry: 'toolbox',
      tool: 'bg-remove',
    })
    expect(readReceipts(actor)).toHaveLength(50)
    expect(readReceipts({ ...actor, scope: 'production' })).toEqual([])
    expect(readReceipts({ ...actor, owner: id(99) })).toEqual([])
    expect(Object.keys(receipt!).sort()).toEqual([
      'createdAt',
      'origin',
      'owner',
      'requestId',
      'scope',
      'sourceKind',
    ])
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 86400000)
    expect(readReceipts(actor)).toEqual([])
  })
  it('画布只触发观察事件，不另存恢复凭据；已取得任务移除凭据', () => {
    saveReceipt(
      'image_job',
      id(1),
      {
        entry: 'canvas',
        tool: 'variation',
        projectId: '项目',
        sceneId: '场景',
        projectSource: 'local',
      },
      false,
    )
    expect(readReceipts(actor)).toEqual([])
    const receipt = saveReceipt('sync_credit', id(2))
    submittedReceipt(receipt, id(3))
    expect(readReceipts(actor)).toEqual([])
  })
  it('存储不可用不阻断提交，发出一次可协调的错误事件', () => {
    const listener = vi.fn()
    window.addEventListener(TASK_CENTER_EVENT, listener)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('不可用')
    })
    expect(saveReceipt('sync_credit', id(1))).toBeTruthy()
    expect(listener.mock.calls.map((c) => c[0].detail.type)).toEqual([
      'storage-error',
      'start',
    ])
    window.removeEventListener(TASK_CENTER_EVENT, listener)
  })
  it('账号切换后取得的旧响应不得删除新账号凭据', () => {
    const receipt = saveReceipt('sync_credit', id(2))
    useUserStore.getState().setAccount({
      userId: id(99),
      runtimeScope: 'preview',
      features: { taskCenter: true },
    } as AccountContext)
    saveReceipt('sync_credit', id(2))
    submittedReceipt(receipt, id(3))
    expect(readReceipts({ owner: id(99), scope: 'preview' })).toHaveLength(1)
  })
  it('工作站新提交清除旧任务绑定，响应按原请求写回单一会话',()=>{
    saveWorkstationSession(actor,'smart-edit',{task:{sourceKind:'image_job',sourceId:id(1)}})
    const receipt=saveReceipt('image_job',id(2),{entry:'workstation',tool:'smart-edit'})
    expect(readWorkstationSession(actor,'smart-edit')?.task).toBeUndefined()
    submittedReceipt(receipt,id(3))
    expect(readWorkstationSession(actor,'smart-edit')?.task).toEqual({sourceKind:'image_job',sourceId:id(3)})
    expect(readReceipts(actor)).toEqual([])
  })
  it('较早请求迟到时，不覆盖已确认的新任务绑定',()=>{
    const start=Date.now();vi.spyOn(Date,'now').mockReturnValue(start)
    const older=saveReceipt('image_job',id(1),{entry:'workstation',tool:'smart-edit'})
    vi.mocked(Date.now).mockReturnValue(start+10)
    const newer=saveReceipt('image_job',id(2),{entry:'workstation',tool:'smart-edit'})
    submittedReceipt(newer,id(4));submittedReceipt(older,id(3))
    expect(readWorkstationSession(actor,'smart-edit')?.task).toEqual({sourceKind:'image_job',sourceId:id(4)})
    expect(readReceipts(actor)).toEqual([])
  })
})
