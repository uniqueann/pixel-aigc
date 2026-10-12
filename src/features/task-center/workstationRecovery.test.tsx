// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { MemoryRouter,useLocation,useSearchParams } from 'react-router-dom'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { useUserStore,type AccountContext } from '@/store/useUserStore'
import { recoveryActor,recoveryDetail,recoverySummary,recoveryOwner } from './recovery.fixture'
import { readWorkstationSession,saveWorkstationSession } from './workstationSession'
import WorkstationRecovery from './WorkstationRecovery'
const mock=vi.hoisted(()=>({request:vi.fn(),read:vi.fn()}))
vi.mock('@/cloud/client',()=>({authEnabled:true,cloudEnabled:false,supabase:null,cloudRequest:mock.request,
  CloudError:class extends Error{constructor(public status:number,message:string,public code:string){super(message)}}}))
vi.mock('@/services/api/ownedImages',()=>({readOwnedImage:mock.read}))
vi.mock('@/features/image-workstation/imageMetadata',()=>({readResultImage:async(blob:Blob)=>({blob,width:64,height:96,mimeType:'image/png'})}))
let client:QueryClient
const task=recoverySummary({tool:'smart-edit',capability:'image_edit',state:'processing',outcomeVersion:null,origin:{entry:'workstation',tool:'smart-edit'}})
const detail=recoveryDetail({task:{...task,state:'succeeded'},results:[{kind:'image',ordinal:0,objectKey:'owned-image',width:0,height:0,mimeType:'image/png',url:'https://example.invalid/image',urlExpiresAt:new Date(Date.now()+60000).toISOString(),availability:'available'}]})
const history=(items=[task])=>({items,nextCursor:null,snapshotAt:new Date().toISOString()})
function account(scope:'preview'|'production'='preview') {useUserStore.getState().setAccount({userId:recoveryOwner,runtimeScope:scope,features:{taskCenter:true}} as AccountContext)}
function Location(){const location=useLocation(),[params,setParams]=useSearchParams();return <><span data-testid="location">{location.search}</span><button onClick={()=>{const next=new URLSearchParams(params);next.delete('task');setParams(next)}}>返回当前编辑</button></>}
function mount(restore=vi.fn(),hasDraft=false,url='/image-workstation/smart-edit') {
  const content=(draft:boolean)=><QueryClientProvider client={client}><App><MemoryRouter initialEntries={[url]}><Location/><WorkstationRecovery tool="smart-edit" nativeBusy={false} hasDraft={draft} onRestoreInput={restore}/></MemoryRouter></App></QueryClientProvider>
  const view=render(content(hasDraft));return {...view,changeDraft:(draft:boolean)=>view.rerender(content(draft)),restore}
}
beforeEach(()=>{account();localStorage.clear();client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});mock.request.mockReset();mock.read.mockReset();mock.read.mockResolvedValue(new Blob(['image'],{type:'image/png'}));vi.stubGlobal('matchMedia',()=>({matches:false,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()}))})
afterEach(()=>{cleanup();client.clear();useUserStore.getState().setAccount(null);vi.unstubAllGlobals();vi.restoreAllMocks()})
describe('工作站自动发现及最小输入恢复',()=>{
  it('普通刷新自动绑定唯一进行中任务，仅发送只读请求',async()=>{
    mock.request.mockResolvedValue(history());mount()
    await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('task='))
    expect(mock.request.mock.calls.every(call=>call[1]==='GET')).toBe(true)
  })
  it('自动接回后可以返回当前编辑，不会被缓存的任务反复拉回',async()=>{
    mock.request.mockResolvedValue(history());mount()
    await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('task='))
    fireEvent.click(screen.getByText('返回当前编辑'))
    await act(async()=>client.invalidateQueries())
    expect(screen.getByTestId('location').textContent).toBe('')
    expect(mock.request).toHaveBeenCalledOnce()
  })
  it('多项进行中由用户选择，排除同名画布任务',async()=>{
    const second={...task,sourceId:recoveryOwner,taskKey:`image_job:${recoveryOwner}`}
    mock.request.mockResolvedValue(history([task,second,{...task,origin:{entry:'canvas',tool:'variation',projectId:'其他项目',sceneId:'其他场景',projectSource:'local'}} as never]))
    mount();await screen.findByText('有多项进行中的任务，请选择要查看的一项')
    expect(screen.getByTestId('location').textContent).toBe('')
    fireEvent.click(screen.getAllByText(/· \d+\/\d+/)[0])
    await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('task='))
  })
  it('指定任务URL不被自动发现覆盖',async()=>{
    mount(vi.fn(),false,`/image-workstation/smart-edit?task=${task.taskKey}`)
    expect(mock.request).not.toHaveBeenCalled()
  })
  it('提交后已完成的原任务也能在刷新后找回，消费本机任务绑定',async()=>{
    saveWorkstationSession(recoveryActor,'smart-edit',{task:{sourceKind:task.sourceKind as 'image_job',sourceId:task.sourceId}})
    mock.request.mockResolvedValue(detail);mount()
    await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('task='))
    expect(readWorkstationSession(recoveryActor,'smart-edit')?.task).toBeUndefined()
    expect(mock.request.mock.calls.every(call=>!call[0].includes('history'))).toBe(true)
  })
  it('输入引用刷新恢复时重新解码，零尺寸声明不进入输入',async()=>{
    saveWorkstationSession(recoveryActor,'smart-edit',{input:{sourceKind:'image_job',sourceId:task.sourceId,ordinal:0}})
    mock.request.mockImplementation(async(path:string)=>path.includes('?view=history')?history([]):detail)
    const {restore}=mount();await waitFor(()=>expect(restore).toHaveBeenCalledOnce())
    expect(restore.mock.calls[0][1]).toMatchObject({width:64,height:96,mimeType:'image/png'})
    expect(localStorage.getItem(`pixel-workstation-session:${recoveryOwner}:preview:smart-edit`)).not.toContain('https:')
  })
  it('读取期间用户开始编辑，不覆盖新草稿',async()=>{
    saveWorkstationSession(recoveryActor,'smart-edit',{input:{sourceKind:'image_job',sourceId:task.sourceId,ordinal:0}})
    let finish!:(value:Blob)=>void;mock.read.mockReturnValue(new Promise(resolve=>{finish=resolve}))
    mock.request.mockImplementation(async(path:string)=>path.includes('?view=history')?history([]):detail)
    const view=mount();await waitFor(()=>expect(mock.read).toHaveBeenCalledOnce())
    view.changeDraft(true);await act(async()=>finish(new Blob(['image'])))
    expect(view.restore).not.toHaveBeenCalled()
  })
  it('读取期间切换环境会取消恢复，旧图片不会进入新环境',async()=>{
    saveWorkstationSession(recoveryActor,'smart-edit',{input:{sourceKind:'image_job',sourceId:task.sourceId,ordinal:0}})
    let finish!:(value:Blob)=>void;mock.read.mockReturnValue(new Promise(resolve=>{finish=resolve}))
    mock.request.mockImplementation(async(path:string)=>path.includes('?view=history')?history([]):detail)
    const view=mount();await waitFor(()=>expect(mock.read).toHaveBeenCalledOnce())
    await act(async()=>account('production'))
    await act(async()=>finish(new Blob(['旧环境图片'])))
    expect(view.restore).not.toHaveBeenCalled()
    expect(readWorkstationSession({...recoveryActor,scope:'production'},'smart-edit')).toBeNull()
  })
  it('本机存储不可用时返回失败，仍可按服务端任务自动发现',async()=>{
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('存储不可用')})
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('存储不可用')})
    expect(saveWorkstationSession(recoveryActor,'smart-edit',{task:{sourceKind:'image_job',sourceId:task.sourceId}})).toBe(false)
    mock.request.mockResolvedValue(history());mount()
    await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('task='))
    expect(mock.request.mock.calls.every(call=>call[1]==='GET')).toBe(true)
  })
  it('本机记录按环境隔离并拒绝过期及额外敏感字段',()=>{
    saveWorkstationSession(recoveryActor,'smart-edit',{input:{sourceKind:'image_job',sourceId:task.sourceId,ordinal:0}})
    expect(readWorkstationSession({...recoveryActor,scope:'production'},'smart-edit')).toBeNull()
    const key=`pixel-workstation-session:${recoveryOwner}:preview:smart-edit`
    localStorage.setItem(key,JSON.stringify({v:1,updatedAt:Date.now(),prompt:'不允许的正文'}))
    expect(readWorkstationSession(recoveryActor,'smart-edit')).toBeNull()
    localStorage.setItem(key,JSON.stringify({v:1,updatedAt:Date.now()-8*86400000}))
    expect(readWorkstationSession(recoveryActor,'smart-edit')).toBeNull()
  })
})
