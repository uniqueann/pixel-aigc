// @vitest-environment jsdom
import { App } from 'antd'
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react'
import { createMemoryRouter,Outlet,RouterProvider,useNavigate } from 'react-router-dom'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { TaskNavigationProvider } from './navigation'
import { useTaskDraftGuard } from './useTaskDraftGuard'
import { useUserStore,type AccountContext } from '@/store/useUserStore'
vi.mock('@/cloud/client',()=>({authEnabled:false,cloudEnabled:false}))
let router:ReturnType<typeof createMemoryRouter>,flush=vi.fn()
function Draft() {
  const navigate=useNavigate()
  useTaskDraftGuard({dirty:true,reason:'当前原图和蒙版会被放弃。',beforeLeave:flush})
  return <><textarea aria-label="当前原图备注" defaultValue="未保存内容"/><button onClick={()=>navigate('/other')}>打开其他工具</button><button onClick={()=>navigate('/draft?task=other')}>查看同页任务</button></>
}
beforeEach(()=>{
  flush=vi.fn().mockResolvedValue(true)
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}))
  const NativeRequest=Request
  // 路由测试没有网络加载器，避免 JSDOM 信号被 Node Request 拒绝。
  vi.stubGlobal('Request',class extends NativeRequest{constructor(input:RequestInfo|URL,init?:RequestInit){super(input,{...init,signal:undefined})}})
  useUserStore.getState().setAccount({userId:'11111111-1111-4111-8111-111111111111',runtimeScope:'preview'} as AccountContext)
  router=createMemoryRouter([{path:'/',element:<TaskNavigationProvider><Outlet/></TaskNavigationProvider>,children:[{path:'draft',element:<Draft/>},{path:'other',element:<p>其他工具</p>}]}],{initialEntries:['/draft']})
  render(<App><RouterProvider router={router}/></App>)
})
afterEach(()=>{cleanup();router.dispose();vi.unstubAllGlobals();useUserStore.getState().setAccount(null)})
describe('任务导航的草稿保护',()=>{
  it('画布保存完成后直接导航，保存过程中不离页也不要求放弃已保存内容',async()=>{
    let complete!:(value:'saved')=>void
    flush.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
    fireEvent.click(screen.getByText('打开其他工具'))
    await waitFor(()=>expect(flush).toHaveBeenCalledOnce())
    expect(router.state.location.pathname).toBe('/draft')
    await act(async()=>complete('saved'))
    await screen.findByText('其他工具')
    expect(screen.queryByText('放弃草稿并继续')).toBeNull()
  })
  it('自动保存期间账号切换，不执行旧会话导航',async()=>{
    let complete!:(value:'saved')=>void
    flush.mockImplementation(()=>new Promise(resolve=>{complete=resolve}))
    fireEvent.click(screen.getByText('打开其他工具'))
    await waitFor(()=>expect(flush).toHaveBeenCalledOnce())
    await act(async()=>useUserStore.getState().setAccount({userId:'33333333-3333-4333-8333-333333333333',runtimeScope:'preview'} as AccountContext))
    await act(async()=>complete('saved'))
    await waitFor(()=>expect([...router.state.blockers.values()].every(blocker=>blocker.state==='unblocked')).toBe(true))
    expect(router.state.location.pathname).toBe('/draft')
  })
  it('取消跨页导航保留当前内容',async()=>{
    fireEvent.click(screen.getByText('打开其他工具'))
    fireEvent.click(await screen.findByText('留在当前页'))
    await waitFor(()=>expect(router.state.location.pathname).toBe('/draft'))
    expect((screen.getByLabelText('当前原图备注') as HTMLTextAreaElement).value).toBe('未保存内容')
  })
  it('只有明确放弃后才切换工具',async()=>{
    fireEvent.click(screen.getByText('打开其他工具'))
    expect(router.state.location.pathname).toBe('/draft')
    fireEvent.click(await screen.findByText('放弃草稿并继续'))
    await screen.findByText('其他工具');expect(router.state.location.pathname).toBe('/other')
  })
  it('同页切换任务不卸载或覆盖当前输入',async()=>{
    fireEvent.click(screen.getByText('查看同页任务'))
    await waitFor(()=>expect(router.state.location.search).toBe('?task=other'))
    expect(screen.queryByText('当前内容尚未保存')).toBeNull()
    expect((screen.getByLabelText('当前原图备注') as HTMLTextAreaElement).value).toBe('未保存内容')
  })
  it('画布同页跳到其他任务时确认，取消不放弃草稿',async()=>{
    cleanup();router.dispose()
    const abandon=vi.fn()
    function CanvasDraft(){
      const navigate=useNavigate()
      useTaskDraftGuard({dirty:true,navigationScope:'canvas-task',reason:'当前画布的生成提示词尚未提交。切换后这些草稿将被放弃。',onAbandon:abandon})
      return <><button onClick={()=>navigate('/canvas/text-to-image?task=22222222-2222-4222-8222-222222222222')}>打开其他任务</button><button onClick={()=>navigate('/canvas/text-to-image')}>关闭任务</button></>
    }
    router=createMemoryRouter([{path:'/',element:<TaskNavigationProvider><Outlet/></TaskNavigationProvider>,children:[{path:'canvas/:mode',element:<CanvasDraft/>}]}],{initialEntries:['/canvas/text-to-image']})
    render(<App><RouterProvider router={router}/></App>)
    fireEvent.click(screen.getByText('打开其他任务'))
    expect(await screen.findByText('当前画布的生成提示词尚未提交。切换后这些草稿将被放弃。')).toBeTruthy()
    fireEvent.click(screen.getByText('留在当前页'))
    await waitFor(()=>expect(router.state.location.search).toBe(''))
    expect(abandon).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('打开其他任务'))
    fireEvent.click(await screen.findByText('放弃草稿并继续'))
    await waitFor(()=>expect(router.state.location.search).toBe('?task=22222222-2222-4222-8222-222222222222'))
    expect(abandon).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByText('关闭任务'))
    await waitFor(()=>expect(router.state.location.pathname+router.state.location.search).toBe('/canvas/text-to-image'))
    expect(abandon).toHaveBeenCalledOnce()
    expect(screen.queryByText('当前画布的生成提示词尚未提交。切换后这些草稿将被放弃。')).toBeNull()
  })
  it('修改稿保存失败时阻止导航',async()=>{
    flush.mockResolvedValue(false)
    fireEvent.click(screen.getByText('打开其他工具'))
    await waitFor(()=>expect(flush).toHaveBeenCalledOnce())
    expect(router.state.location.pathname).toBe('/draft')
    expect(screen.queryByText('放弃草稿并继续')).toBeNull()
  })
  it('离开画布页面时未提交提示词需确认，取消留在当前页，确认后放弃草稿并继续',async()=>{
    cleanup();router.dispose()
    const abandon=vi.fn()
    function CanvasDraft(){
      const navigate=useNavigate()
      useTaskDraftGuard({dirty:true,navigationScope:'canvas-task',reason:'未提交提示词',onAbandon:abandon})
      return <button onClick={()=>navigate('/other')}>离开画布</button>
    }
    router=createMemoryRouter([{path:'/',element:<TaskNavigationProvider><Outlet/></TaskNavigationProvider>,children:[{path:'canvas/:mode',element:<CanvasDraft/>},{path:'other',element:<p>其他工具</p>}]}],{initialEntries:['/canvas/text-to-image']})
    render(<App><RouterProvider router={router}/></App>)
    fireEvent.click(screen.getByText('离开画布'))
    expect(await screen.findByText('未提交提示词')).toBeTruthy()
    fireEvent.click(screen.getByText('留在当前页'))
    await waitFor(()=>expect(router.state.location.pathname).toBe('/canvas/text-to-image'))
    expect(abandon).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('离开画布'))
    fireEvent.click(await screen.findByText('放弃草稿并继续'))
    await screen.findByText('其他工具')
    expect(abandon).toHaveBeenCalledOnce()
  })
  it('画布确认期间换账号，不能清空旧提示词或继续原导航',async()=>{
    cleanup();router.dispose()
    const abandon=vi.fn()
    function CanvasDraft(){
      const navigate=useNavigate()
      useTaskDraftGuard({dirty:true,navigationScope:'canvas-task',reason:'未提交提示词',onAbandon:abandon})
      return <button onClick={()=>navigate('/canvas/text-to-image?task=另一任务')}>切换任务</button>
    }
    router=createMemoryRouter([{path:'/',element:<TaskNavigationProvider><Outlet/></TaskNavigationProvider>,children:[{path:'canvas/:mode',element:<CanvasDraft/>}]}],{initialEntries:['/canvas/text-to-image']})
    render(<App><RouterProvider router={router}/></App>)
    fireEvent.click(screen.getByText('切换任务'))
    await screen.findByText('放弃草稿并继续')
    await act(async()=>useUserStore.getState().setAccount({userId:'33333333-3333-4333-8333-333333333333',runtimeScope:'preview'} as AccountContext))
    fireEvent.click(screen.getByText('放弃草稿并继续'))
    await waitFor(()=>expect([...router.state.blockers.values()].every(blocker=>blocker.state==='unblocked')).toBe(true))
    expect(abandon).not.toHaveBeenCalled()
    expect(router.state.location.search).toBe('')
  })
  it('确认窗口期间账号切换，不执行旧会话导航',async()=>{
    fireEvent.click(screen.getByText('打开其他工具'))
    await screen.findByText('放弃草稿并继续')
    await act(async()=>useUserStore.getState().setAccount({userId:'33333333-3333-4333-8333-333333333333',runtimeScope:'preview'} as AccountContext))
    fireEvent.click(screen.getByText('放弃草稿并继续'))
    await waitFor(()=>expect([...router.state.blockers.values()].every(blocker=>blocker.state==='unblocked')).toBe(true))
    expect(router.state.location.pathname).toBe('/draft')
  })
})
