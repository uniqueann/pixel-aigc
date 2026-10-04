// @vitest-environment jsdom

import { App } from 'antd'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import MainLayout from '@/layouts/MainLayout'
import { useCanvasActionGate } from './canvasActionGate'
import { CanvasProjectCrumb, CanvasProjectMenu } from './CanvasProjectHeader'
import { isProjectSaveShortcut, projectSaveShortcutLabel } from './projectActions'

const mocks = vi.hoisted(() => ({
  flushProject: vi.fn(async () => undefined),
  exportProject: vi.fn(),
  newProject: vi.fn(async () => undefined),
  replaceSnapshot: vi.fn(async () => undefined),
  hasUnfinishedGeneration: vi.fn(() => false),
}))

vi.mock('@/editor/persistence/projectPersistence', () => ({
  flushProject: mocks.flushProject,
  exportProject: mocks.exportProject,
  newProject: mocks.newProject,
  replaceSnapshot: mocks.replaceSnapshot,
  hasUnfinishedGeneration: () => mocks.hasUnfinishedGeneration(),
  currentSnapshot: vi.fn(),
  updateRuntimeAssetAccess: vi.fn(),
}))

function renderHeader() {
  return render(
    <App>
      <CanvasProjectCrumb />
      <CanvasProjectMenu />
    </App>,
  )
}

describe('自由画布顶栏项目操作', () => {
  beforeEach(() => {
    mocks.flushProject.mockClear()
    mocks.exportProject.mockClear()
    mocks.newProject.mockClear()
    mocks.replaceSnapshot.mockClear()
    mocks.hasUnfinishedGeneration.mockReset()
    mocks.hasUnfinishedGeneration.mockReturnValue(false)
    useCanvasActionGate.setState({ blocked: false })
    useEditorStore.getState().createProject('图片工作台')
    usePersistenceStore.setState({ phase: 'ready', status: 'saved', error: undefined, writable: true })
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('按平台显示保存快捷键，并忽略带修饰或重复的按键', () => {
    expect(projectSaveShortcutLabel('MacIntel')).toBe('⌘S')
    expect(projectSaveShortcutLabel('Win32')).toBe('Ctrl+S')
    expect(isProjectSaveShortcut({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false })).toBe(true)
    expect(isProjectSaveShortcut({ key: 's', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, repeat: false })).toBe(true)
    expect(isProjectSaveShortcut({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true, repeat: false })).toBe(false)
    expect(isProjectSaveShortcut({ key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: true })).toBe(false)
    expect(isProjectSaveShortcut({ key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, repeat: false })).toBe(false)
  })

  it('项目名回车或失焦后写入原存储，空值和 Esc 回退原名', () => {
    renderHeader()
    expect(screen.getByRole('navigation', { name: '面包屑' }).textContent).toContain('自由画布')
    expect(screen.getByRole('status', { name: '✓ 已保存' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /编辑项目名称/ }))
    const input = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(input, { target: { value: '商品主图' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(useEditorStore.getState().project?.name).toBe('商品主图')
    expect(screen.queryByRole('textbox', { name: '项目名称' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /编辑项目名称/ }))
    const renamed = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(renamed, { target: { value: '   ' } })
    fireEvent.blur(renamed)
    expect(useEditorStore.getState().project?.name).toBe('商品主图')

    fireEvent.click(screen.getByRole('button', { name: /编辑项目名称/ }))
    const again = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(again, { target: { value: '临时名称' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(useEditorStore.getState().project?.name).toBe('商品主图')
    expect(screen.getByRole('button', { name: /编辑项目名称/ }).textContent).toContain('商品主图')
  })

  it('菜单沿用保存、导入导出和新建确认，生成中禁用导入与新建', async () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: '项目操作' }))
    expect(await screen.findByText('Ctrl+S')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /立即保存/ }))
    expect(mocks.flushProject).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '项目操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '导出 JSON' }))
    expect(mocks.exportProject).toHaveBeenCalledOnce()

    const file = document.querySelector('input[type="file"]') as HTMLInputElement
    const click = vi.spyOn(file, 'click').mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole('button', { name: '项目操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '导入 JSON' }))
    expect(click).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '项目操作' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '新建项目' }))
    expect(await screen.findAllByText('新建空白项目？')).not.toHaveLength(0)
    expect(screen.getAllByText('当前项目会保留本地存档；未同步的内容建议先导出 JSON。')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /新\s*建/ }))
    expect(mocks.newProject).toHaveBeenCalledOnce()

    useCanvasActionGate.setState({ blocked: true })
    fireEvent.click(screen.getByRole('button', { name: '项目操作' }))
    expect((await screen.findByRole('menuitem', { name: '导入 JSON' })).getAttribute('aria-disabled')).toBe('true')
    expect((screen.getByRole('menuitem', { name: '新建项目' })).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: /立即保存/ }).getAttribute('aria-disabled')).not.toBe('true')
  })

  it('输入框内 Ctrl+S 也会立即保存并阻止浏览器默认行为', async () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /编辑项目名称/ }))
    const input = screen.getByRole('textbox', { name: '项目名称' })
    fireEvent.change(input, { target: { value: '快捷键画布' } })
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => { input.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(useEditorStore.getState().project?.name).toBe('快捷键画布')
    expect(mocks.flushProject).toHaveBeenCalledOnce()

    usePersistenceStore.setState({ phase: 'loading' })
    const blocked = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    await act(async () => { window.dispatchEvent(blocked) })
    expect(blocked.defaultPrevented).toBe(true)
    expect(mocks.flushProject).toHaveBeenCalledOnce()
  })

  it('只有自由画布顶栏出现项目名和项目操作', () => {
    const { unmount } = render(
      <App>
        <MemoryRouter initialEntries={['/canvas/text-to-image']}>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route path="canvas/:mode" element={<div>画布页</div>} />
              <Route path="toolbox/:tool" element={<div>工具箱页</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </App>,
    )
    expect(screen.getByRole('button', { name: '项目操作' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '面包屑' }).textContent).toContain('自由画布')
    expect(screen.getByText('画布页')).toBeTruthy()
    unmount()

    render(
      <App>
        <MemoryRouter initialEntries={['/toolbox/bg-remove']}>
          <Routes>
            <Route path="/" element={<MainLayout />}>
              <Route path="canvas/:mode" element={<div>画布页</div>} />
              <Route path="toolbox/:tool" element={<div>工具箱页</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </App>,
    )
    expect(screen.queryByRole('button', { name: '项目操作' })).toBeNull()
    expect(screen.queryByRole('button', { name: /编辑项目名称/ })).toBeNull()
    expect(screen.getAllByText('工具箱').length).toBeGreaterThan(0)
    expect(screen.getAllByText('智能抠图').length).toBeGreaterThan(0)
  })
})
