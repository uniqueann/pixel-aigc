// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { MemoryRouter,useNavigate } from 'react-router-dom'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { useUserStore,type AccountContext } from '@/store/useUserStore'
import type { TaskCenterDetail } from '@shared/task-center'
import { parseTaskRoute,taskDestination } from './route'
import { recoveryActor,recoveryDetail,recoveryId,recoverySummary,recoveryOwner } from './recovery.fixture'
import TaskRecoveryPanel from './TaskRecoveryPanel'

const mocks=vi.hoisted(()=>({request:vi.fn(),read:vi.fn()}))
vi.mock('@/cloud/client',()=>({authEnabled:true,cloudEnabled:false,supabase:null,cloudRequest:mocks.request,
  CloudError:class extends Error{constructor(public status:number,message:string,public code:string){super(message)}}}))
vi.mock('@/services/api/ownedImages',()=>({readOwnedImage:mocks.read}))
vi.mock('@/features/image-workstation/imageMetadata',()=>({readResultImage:async(blob:Blob)=>({blob,width:64,height:64,mimeType:'image/png'})}))
let client:QueryClient
function account(owner=recoveryOwner,scope:'local'|'preview'|'production'='preview') {
  useUserStore.getState().setAccount({userId:owner,runtimeScope:scope,features:{taskCenter:true},email:'test@example.invalid',credits:30,status:'active'} as AccountContext)
}
beforeEach(()=>{
  account();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})
  mocks.request.mockReset();mocks.read.mockReset();mocks.read.mockResolvedValue(new Blob(['fixture'],{type:'image/png'}))
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}))
})
afterEach(()=>{cleanup();client.clear();useUserStore.getState().setAccount(null);vi.unstubAllGlobals()})
function SwitchTask(){const navigate=useNavigate();return <button onClick={()=>navigate(`/image-workstation/smart-edit?task=image_job:${recoveryOwner}`)}>切换另一任务</button>}
function mount(detail:TaskCenterDetail,recover=vi.fn()) {
  mocks.request.mockImplementation(async(path:string,method:string)=>method==='PATCH'||path.includes('by-request')?detail.task:detail)
  render(<QueryClientProvider client={client}><App><MemoryRouter initialEntries={[`/image-workstation/smart-edit?task=${detail.task.taskKey}`]}>
    <textarea aria-label="当前草稿" defaultValue="保持当前输入"/><SwitchTask/><TaskRecoveryPanel tools={['smart-edit']} onLoadParameters={recover}/>
  </MemoryRouter></App></QueryClientProvider>)
  return recover
}
describe('任务定位与只读工具绑定',()=>{
  it('严格解析原身份，不接受 URL、额外分隔符或不合法来源',()=>{
    expect(parseTaskRoute(`image_job:${recoveryId}`)?.sourceId).toBe(recoveryId)
    for(const raw of ['https://example.invalid','unknown:'+recoveryId,`image_job:${recoveryId}:other`,'image_job:x'])expect(parseTaskRoute(raw)).toBeNull()
  })
  it('使用白名单工具及原画布来源；缺少画布来源不猜项目',()=>{
    expect(taskDestination(recoverySummary())).toBeNull()
    const canvas=recoverySummary({origin:{entry:'canvas',tool:'text-to-image',projectId:'原项目',projectSource:'local',sceneId:'原场景'}})
    const url=taskDestination(canvas)!
    expect(new URL(url,'https://local.invalid').searchParams.get('projectId')).toBe('原项目')
    expect(taskDestination(recoverySummary({tool:'relight',capability:'image_edit'}))).toContain('/image-workstation/relight?task=')
  })
  it('打开结果保持草稿，参数只有点击后才载入，查询没有生成 POST',async()=>{
    const detail=recoveryDetail({task:recoverySummary({tool:'smart-edit',capability:'image_edit'}),params:{sourceImageKey:'owned-input',prompt:'原参数',count:1,resolution:'1k'}})
    const load=mount(detail)
    await screen.findByText('载入原参数')
    expect(load).not.toHaveBeenCalled();expect((screen.getByLabelText('当前草稿') as HTMLTextAreaElement).value).toBe('保持当前输入')
    fireEvent.click(screen.getByText('载入原参数'))
    await waitFor(()=>expect(load).toHaveBeenCalledOnce())
    expect(mocks.read).toHaveBeenCalledWith({objectKey:'owned-input'},expect.objectContaining({ownerId:recoveryOwner,signal:expect.any(AbortSignal)}))
    expect(mocks.request.mock.calls.every(call=>!['POST','DELETE'].includes(call[1]))).toBe(true)
  })
  it('源输入读取失败时不执行参数写入；保留当前草稿',async()=>{
    mocks.read.mockRejectedValue(new Error('原图已不可用'))
    const load=mount(recoveryDetail({task:recoverySummary({tool:'smart-edit',capability:'image_edit'}),params:{sourceImageKey:'missing'}}))
    fireEvent.click(await screen.findByText('载入原参数'))
    await waitFor(()=>expect(screen.getAllByText('原图已不可用').length).toBeGreaterThan(0))
    expect(load).not.toHaveBeenCalled();expect((screen.getByLabelText('当前草稿') as HTMLTextAreaElement).value).toBe('保持当前输入')
  })
  it('同页切换任务取消旧输入读取，不载入上一任务参数',async()=>{
    let finish!:(value:Blob)=>void
    mocks.read.mockReturnValue(new Promise(resolve=>{finish=resolve}))
    const load=mount(recoveryDetail({task:recoverySummary({tool:'smart-edit',capability:'image_edit'}),params:{sourceImageKey:'delayed'}}))
    fireEvent.click(await screen.findByText('载入原参数'));await waitFor(()=>expect(mocks.read).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByText('切换另一任务'))
    await act(async()=>finish(new Blob(['fixture'],{type:'image/png'})))
    expect(load).not.toHaveBeenCalled()
  })
  it('账号或环境切换后，旧参数读取不能写入新会话',async()=>{
    let finish!:(value:Blob)=>void
    mocks.read.mockReturnValue(new Promise(resolve=>{finish=resolve}))
    const load=mount(recoveryDetail({task:recoverySummary({tool:'smart-edit',capability:'image_edit'}),params:{sourceImageKey:'delayed'}}))
    fireEvent.click(await screen.findByText('载入原参数'));await waitFor(()=>expect(mocks.read).toHaveBeenCalledOnce())
    await act(async()=>account(recoveryActor.owner,'production'))
    await act(async()=>finish(new Blob(['fixture'],{type:'image/png'})))
    expect(load).not.toHaveBeenCalled()
  })
  it('同步记录没有原参数时禁用载入，不用结果推测蒙版',async()=>{
    const load=mount(recoveryDetail({task:recoverySummary({tool:'smart-edit',capability:'image_edit'}),params:null}))
    expect((await screen.findByText('载入原参数')).closest('button')?.disabled).toBe(true)
    expect(load).not.toHaveBeenCalled()
  })
  it('准备重新生成只载入参数，不替用户点击生成按钮',async()=>{
    vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{callback(0);return 1})
    const load=mount(recoveryDetail({task:recoverySummary({tool:'smart-edit',capability:'image_edit'}),params:{sourceImageKey:'owned-input'}}))
    fireEvent.click(await screen.findByText('准备重新生成'))
    await waitFor(()=>expect(load).toHaveBeenCalledOnce())
    expect(mocks.request.mock.calls.some(call=>call[1]==='POST')).toBe(false)
  })
})
