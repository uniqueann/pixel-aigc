// @vitest-environment jsdom
import { StrictMode } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import CanvasProjectRoute from './CanvasProjectRoute'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { setPersistenceUser } from '@/editor/persistence/database'
import { useEditorStore } from '@/editor/store'
import { useUserStore } from '@/store/useUserStore'
import type { OpenProjectOptions } from '@/cloud/sync'

const mocks = vi.hoisted(() => ({ open: vi.fn(), unfinished: false }))
const useTestCloudStore = create(() => ({ busy: false }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: true }))
vi.mock('@/cloud/sync', () => ({ openCloudProject: mocks.open, openLocalProject: mocks.open,
  useCloudStore: Object.assign((selector: (state: { busy: boolean }) => boolean) => useTestCloudStore(selector), { getState: () => useTestCloudStore.getState() }),
}))
vi.mock('@/editor/persistence/projectPersistence', () => ({ hasUnfinishedGeneration: () => mocks.unfinished }))
vi.mock('@/pages/FreeCanvas', () => ({ default: () => <p>画布内容</p> }))

const OWNER = '11111111-1111-4111-8111-111111111111'
function Navigation() {
  const location = useLocation(), navigate = useNavigate()
  return <><output data-testid="canvas-url">{location.pathname + location.search}</output><button onClick={() => navigate('/')}>离开画布</button></>
}
function PhaseGate() {
  const phase = usePersistenceStore(state => state.phase), epoch = usePersistenceStore(state => state.epoch)
  return phase === 'loading' ? <p>恢复中</p> : <div key={epoch}><CanvasProjectRoute /></div>
}
function mount(id = '其他') {
  return render(<StrictMode><MemoryRouter initialEntries={[`/canvas/text-to-image?projectId=${id}&projectSource=local`]}><Navigation /><Routes>
    <Route path="/canvas/:mode" element={<PhaseGate />} /><Route path="/" element={<p>首页</p>} />
  </Routes></MemoryRouter></StrictMode>)
}
beforeEach(() => {
  mocks.open.mockReset(); mocks.unfinished = false
  setPersistenceUser(OWNER); useUserStore.setState({ userId: OWNER })
  usePersistenceStore.setState({ ownerId: OWNER, phase: 'ready', epoch: 0, writable: true, status: 'saved', cloud: undefined, error: undefined })
  useTestCloudStore.setState({ busy: false })
  useEditorStore.getState().createProject('当前画布')
})
afterEach(cleanup)

describe('首页画布入口保护', () => {
  it('继续当前项目立即回画布并消耗参数，不重新加载', async () => {
    mount(useEditorStore.getState().project!.id)
    await waitFor(() => expect(screen.getByText('画布内容')).toBeTruthy())
    expect(screen.getByTestId('canvas-url').textContent).toBe('/canvas/text-to-image')
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('未同步画布先确认，取消保留当前内容', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('保留当前画布并打开其他项目？')).toBeTruthy())
    expect(screen.queryByText('画布内容')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))
    await waitFor(() => expect(screen.getByText('画布内容')).toBeTruthy())
    expect(mocks.open).not.toHaveBeenCalled()
    expect(useEditorStore.getState().project?.name).toBe('当前画布')
  })

  it.each(['未完成任务', '保存失败', '版本冲突', '无编辑权'] as const)('%s时阻止打开其他项目', async reason => {
    if (reason === '未完成任务') mocks.unfinished = true
    if (reason === '保存失败') usePersistenceStore.setState({ status: 'error' })
    if (reason === '版本冲突') usePersistenceStore.setState({ cloud: { revision: 2, pending: true, conflict: true } })
    if (reason === '无编辑权') usePersistenceStore.setState({ writable: false })
    mount()
    await waitFor(() => expect(screen.getByText('无法打开项目')).toBeTruthy())
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it('严格模式只发起一次打开；离开页面会取消等待请求', async () => {
    useEditorStore.setState({ project: null })
    mocks.open.mockReturnValue(new Promise(() => undefined))
    mount()
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(1))
    const options = mocks.open.mock.calls[0][1] as OpenProjectOptions
    expect(options.signal?.aborted).toBe(false)
    fireEvent.click(screen.getByText('离开画布'))
    expect(options.signal?.aborted).toBe(true)
  })

  it('持久化切换阶段卸载入口不会取消正在提交的事务，完成后回新画布', async () => {
    useEditorStore.setState({ project: null })
    let finish!: () => void
    mocks.open.mockImplementation(async (_id: string, options: OpenProjectOptions) => {
      options.onCommitStart?.()
      act(() => usePersistenceStore.setState({ phase: 'loading' }))
      await new Promise<void>(done => { finish = done })
      expect(options.signal?.aborted).toBe(false)
      useEditorStore.getState().createProject('其他')
      useEditorStore.setState(state => ({ project: { ...state.project!, id: '其他' } }))
      usePersistenceStore.setState({ phase: 'ready', epoch: 1 })
    })
    mount()
    await waitFor(() => expect(screen.getByText('恢复中')).toBeTruthy())
    await act(async () => { finish(); await Promise.resolve() })
    await waitFor(() => expect(screen.getByText('画布内容')).toBeTruthy())
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('canvas-url').textContent).toBe('/canvas/text-to-image')
  })
})
