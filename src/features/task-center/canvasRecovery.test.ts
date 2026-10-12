// @vitest-environment jsdom
import { beforeEach,describe,expect,it,vi } from 'vitest'
import { useUserStore,type AccountContext } from '@/store/useUserStore'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { generationIdForTask } from '@/editor/adapters/taskAdapter'
import type { TaskCenterDetail } from '@shared/task-center'
import { Capability } from '@/types'
import { applyRecoveredCanvasTask,type CanvasRecoveryContext } from './canvasRecovery'
import { recoveryActor,recoveryDetail,recoveryImage,recoveryId,recoverySummary } from './recovery.fixture'
const mocks=vi.hoisted(()=>({read:vi.fn(),record:vi.fn(),history:vi.fn(),deleted:vi.fn(),flush:vi.fn()}))
vi.mock('@/cloud/client',()=>({authEnabled:true,cloudEnabled:false,supabase:null}))
vi.mock('@/services/api/ownedImages',()=>({readOwnedImage:mocks.read}))
vi.mock('@/features/assets/workstationHistory',()=>({listHistoryMetadata:mocks.history,listHistoryDeletions:mocks.deleted,recordWorkstationHistory:mocks.record,recordVideoHistory:mocks.record}))
vi.mock('@/features/image-workstation/imageMetadata',()=>({readResultImage:async(blob:Blob)=>({blob,width:64,height:64,mimeType:'image/png'})}))
vi.mock('@/editor/persistence/projectPersistence',()=>({flushProject:mocks.flush}))
let context:CanvasRecoveryContext,detail:TaskCenterDetail
beforeEach(()=>{
  vi.clearAllMocks();mocks.history.mockResolvedValue([]);mocks.deleted.mockResolvedValue([]);mocks.read.mockResolvedValue(new Blob(['image'],{type:'image/png'}));mocks.flush.mockResolvedValue(undefined)
  useUserStore.getState().setAccount({userId:recoveryActor.owner,runtimeScope:'preview',features:{taskCenter:true}} as AccountContext)
  const project=useEditorStore.getState().createProject('恢复测试')
  usePersistenceStore.setState({phase:'ready',writable:true,epoch:1,recoveries:{}})
  const sceneId=project.document.activeSceneId
  context={actor:recoveryActor,projectId:project.id,sceneId,epoch:1,signal:new AbortController().signal}
  detail=recoveryDetail({task:recoverySummary({origin:{entry:'canvas',tool:'text-to-image',projectId:project.id,sceneId,projectSource:'local'}})})
})
function seed() {
  useEditorStore.getState().registerGeneration({id:generationIdForTask(recoveryId),backendTaskId:recoveryId,capability:Capability.TextToImage,status:'processing',input:detail.params,inputAssetIds:[],outputAssetIds:[],createdAt:detail.task.createdAt,updatedAt:detail.task.createdAt})
  usePersistenceStore.getState().setRecovery({projectId:context.projectId,sceneId:context.sceneId,ownerId:context.actor.owner,
    request:{capability:Capability.TextToImage,requestId:recoveryId,params:detail.params as never},context:{inputAssetIds:[],automaticRetry:false,autoRetryRemaining:0},
    placements:[{x:10,y:20,width:64,height:64},{x:90,y:20,width:64,height:64}],backendTaskId:recoveryId,applied:false,replacedPlaceholderIds:[]})
  for(let index=0;index<2;index++)useEditorStore.getState().addNode(context.sceneId,{id:`placeholder:${index}`,type:'generation',generationId:generationIdForTask(recoveryId),resultIndex:index,x:10+index*80,y:20,width:64,height:64,rotation:0,opacity:1,visible:true,locked:false,zIndex:index})
}
describe('原画布任务接续',()=>{
  it('没有恢复上下文时只读，不凭来源自动插图',async()=>{
    await applyRecoveredCanvasTask(detail,context)
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(0)
    expect(mocks.read).not.toHaveBeenCalled();expect(mocks.record).not.toHaveBeenCalled()
  })
  it('部分成功按序号替换原占位，刷新不重复登记节点与资产',async()=>{
    seed();detail.results=[recoveryImage(1)]
    await applyRecoveredCanvasTask(detail,context)
    await applyRecoveredCanvasTask(detail,context)
    const project=useEditorStore.getState().project!
    expect(project.document.scenes[0].nodes).toHaveLength(1)
    expect(project.document.scenes[0].nodes[0]).toMatchObject({x:90,y:20,id:`generated-node:${recoveryId}:1`})
    expect(Object.values(project.assets)).toHaveLength(1);expect(mocks.record).toHaveBeenCalledOnce()
  })
  it('迟到的新序号补入，已经应用的结果不重复插入',async()=>{
    seed();await applyRecoveredCanvasTask(detail,context)
    detail={...detail,task:{...detail.task,completedCount:2,outcomeVersion:'v1:new'},results:[recoveryImage(0),recoveryImage(1)]}
    await applyRecoveredCanvasTask(detail,context)
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(2)
    expect(mocks.record).toHaveBeenCalledTimes(2)
  })
  it('用户删除已恢复节点后，刷新不重新插入',async()=>{
    seed();await applyRecoveredCanvasTask(detail,context)
    useEditorStore.getState().removeNode(context.sceneId,`generated-node:${recoveryId}:0`)
    await applyRecoveredCanvasTask(detail,context)
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(0)
  })
  it('无上下文时显式添加同一结果两次，只登记一次',async()=>{
    const result=recoveryImage()
    await applyRecoveredCanvasTask(detail,context,result);await applyRecoveredCanvasTask(detail,context,result)
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(1)
    expect(mocks.record).toHaveBeenCalledOnce()
  })
  it('项目、场景或编辑权变化后拒绝写回',async()=>{
    seed();usePersistenceStore.setState({writable:false})
    await expect(applyRecoveredCanvasTask(detail,context)).rejects.toThrow('编辑权')
    usePersistenceStore.setState({writable:true});useEditorStore.getState().createProject('另一个项目')
    await expect(applyRecoveredCanvasTask(detail,context)).rejects.toThrow('已切换')
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it('结果读取途中切换账号，原节点和资产均不写入新账号',async()=>{
    seed();let finish!:(blob:Blob)=>void;mocks.read.mockReturnValue(new Promise(resolve=>{finish=resolve}))
    const reading=applyRecoveredCanvasTask(detail,context)
    useUserStore.getState().setAccount({userId:'33333333-3333-4333-8333-333333333333',runtimeScope:'preview'} as AccountContext)
    finish(new Blob(['image'],{type:'image/png'}))
    await expect(reading).rejects.toThrow('已切换')
    expect(Object.values(useEditorStore.getState().project!.assets)).toHaveLength(0);expect(mocks.record).not.toHaveBeenCalled()
  })
  it('超时后有迟到结果仍保留失败事实，不改为成功',async()=>{
    seed();detail.task={...detail.task,state:'expired',billingState:'refunded',creditsCharged:0,creditsReturned:6}
    await applyRecoveredCanvasTask(detail,context)
    expect(useEditorStore.getState().project!.generations[generationIdForTask(recoveryId)].status).toBe('failed')
    expect(detail.task.billingState).toBe('refunded')
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(1)
  })
  it('已删除的本地历史不因查看恢复重新登记',async()=>{
    seed();mocks.deleted.mockResolvedValue([{objectKey:recoveryImage().objectKey,id:'old'}])
    await applyRecoveredCanvasTask(detail,context)
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it('未收到任务编号的原请求可绑定已有服务端任务，不需要再次提交',async()=>{
    const requestId='44444444-4444-4444-8444-444444444444'
    usePersistenceStore.getState().setRecovery({projectId:context.projectId,sceneId:context.sceneId,ownerId:context.actor.owner,
      request:{capability:Capability.TextToImage,requestId,params:detail.params as never},context:{inputAssetIds:[],automaticRetry:false,autoRetryRemaining:0},
      placements:[{x:10,y:20,width:64,height:64}],applied:false,replacedPlaceholderIds:[]})
    detail.task={...detail.task,requestId}
    await applyRecoveredCanvasTask(detail,context)
    expect(usePersistenceStore.getState().recoveries[requestId]).toMatchObject({backendTaskId:recoveryId,applied:true})
    expect(useEditorStore.getState().project!.document.scenes[0].nodes).toHaveLength(1)
  })
})
