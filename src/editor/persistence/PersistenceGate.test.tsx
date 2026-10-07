// @vitest-environment jsdom
import { App } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter } from 'react-router-dom'
import { usePersistenceStore } from './persistenceStore'
import PersistenceGate from './PersistenceGate'

const mocks = vi.hoisted(() => ({
  initializePersistence: vi.fn(async () => undefined),
  acquireEditLock: vi.fn(async () => true),
  releaseEditLock: vi.fn(async () => undefined),
  reclaimEditAccess: vi.fn(async () => undefined),
  restartAfterLoadError: vi.fn(async () => undefined),
  downloadJson: vi.fn(),
}))

vi.mock('./projectPersistence', () => ({
  initializePersistence: mocks.initializePersistence,
  acquireEditLock: mocks.acquireEditLock,
  releaseEditLock: mocks.releaseEditLock,
  reclaimEditAccess: mocks.reclaimEditAccess,
  restartAfterLoadError: mocks.restartAfterLoadError,
  downloadJson: mocks.downloadJson,
}))

function renderGate(path: string) {
  return render(
    <App>
      <MemoryRouter initialEntries={[path]}>
        <PersistenceGate>
          <p>页面内容</p>
          <Link to="/image-workstation/smart-edit">离开画布</Link>
          <Link to="/canvas/text-to-image">打开画布</Link>
        </PersistenceGate>
      </MemoryRouter>
    </App>,
  )
}

beforeEach(() => {
  mocks.initializePersistence.mockClear()
  mocks.acquireEditLock.mockClear()
  mocks.releaseEditLock.mockClear()
  mocks.reclaimEditAccess.mockClear()
  mocks.restartAfterLoadError.mockClear()
  mocks.downloadJson.mockClear()
  usePersistenceStore.setState({
    phase: 'ready', writable: false, lockPhase: 'idle', status: 'saved', error: undefined, raw: undefined, epoch: 0,
  })
})

afterEach(() => { cleanup() })

describe('PersistenceGate 编辑锁范围', () => {
  it('非画布页面只读取，不申请编辑锁，也不挡住页面', async () => {
    renderGate('/image-workstation/smart-edit')
    expect(screen.getByText('页面内容')).toBeTruthy()
    expect(screen.queryByText('本站的其他标签页正在编辑这个项目')).toBeNull()
    await waitFor(() => expect(mocks.initializePersistence).toHaveBeenCalledOnce())
    expect(mocks.acquireEditLock).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.releaseEditLock).toHaveBeenCalled())
  })

  it('进入画布才申请编辑锁，尚未返回结果时不显示只读提示', async () => {
    renderGate('/canvas/text-to-image')
    expect(screen.getByText('正在取得项目编辑权…')).toBeTruthy()
    expect(screen.queryByText('页面内容')).toBeNull()
    expect(screen.queryByText('本站的其他标签页正在编辑这个项目')).toBeNull()
    await waitFor(() => expect(mocks.acquireEditLock).toHaveBeenCalledOnce())
    expect(mocks.releaseEditLock).not.toHaveBeenCalled()
  })

  it('画布拿不到锁时说明是本站其他标签页正在编辑，并可用 steal 重新取得', async () => {
    usePersistenceStore.setState({ lockPhase: 'blocked', raw: { schemaVersion: 1 } })
    renderGate('/canvas/text-to-image')
    expect(screen.getByText('本站的其他标签页正在编辑这个项目')).toBeTruthy()
    expect(screen.getByText('此页面已变为只读。重新取得编辑权时，正在编辑的标签页会先保存存档，再变为只读。')).toBeTruthy()
    expect(screen.queryByText('页面内容')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新读取并取得编辑权' }))
    expect(mocks.reclaimEditAccess).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '下载原始存档' }))
    expect(mocks.downloadJson).toHaveBeenCalledWith({ schemaVersion: 1 }, '项目原始存档.json')
  })

  it('离开画布路由时释放编辑锁，其他页面继续显示', async () => {
    usePersistenceStore.setState({ writable: true, lockPhase: 'held' })
    renderGate('/canvas/text-to-image')
    expect(screen.getByText('页面内容')).toBeTruthy()
    await waitFor(() => expect(mocks.acquireEditLock).toHaveBeenCalled())
    expect(mocks.releaseEditLock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '离开画布' }))
    expect(screen.getByText('页面内容')).toBeTruthy()
    await waitFor(() => expect(mocks.releaseEditLock).toHaveBeenCalled())
  })

  it('从其他页面进入画布后才申请锁', async () => {
    renderGate('/image-workstation/smart-edit')
    await waitFor(() => expect(mocks.releaseEditLock).toHaveBeenCalled())
    expect(mocks.acquireEditLock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '打开画布' }))
    await waitFor(() => expect(mocks.acquireEditLock).toHaveBeenCalled())
  })

  it('存档损坏时仍提供重新读取并取得编辑权', async () => {
    usePersistenceStore.setState({ phase: 'error', error: '存档无法解析', writable: false, lockPhase: 'idle' })
    renderGate('/canvas/text-to-image')
    expect(screen.getByText('无法恢复本地项目')).toBeTruthy()
    expect(screen.getByText('存档无法解析')).toBeTruthy()
    expect(screen.queryByText('本站的其他标签页正在编辑这个项目')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新读取并取得编辑权' }))
    expect(mocks.reclaimEditAccess).toHaveBeenCalledOnce()
    expect(mocks.acquireEditLock).not.toHaveBeenCalled()
  })
})
