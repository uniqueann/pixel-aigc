// @vitest-environment jsdom

import { App } from 'antd'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tool: 'variation',
  status: {
    capabilities: { imageEdit: undefined, variation: undefined, repaint: undefined, smartSelect: undefined } as Record<string, boolean | undefined>,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  controller: { outputAssets: [], formLocked: false, replaceSourceAsset: vi.fn() },
}))
vi.mock('react-router-dom', () => ({ useParams: () => ({ tool: mocks.tool }), useNavigate: () => vi.fn() }))
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => mocks.status }))
vi.mock('@/features/image-workstation/hooks/useImageWorkstationController', () => ({ useImageWorkstationController: () => mocks.controller }))
vi.mock('@/services/api/imageModels', () => ({ listImageModels: () => Promise.resolve([]) }))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false }))
vi.mock('@/components/GenerationTaskStatus', () => ({ default: () => null }))

import ImageWorkstation from './index'

describe('图片工作站配置提示', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    mocks.status.capabilities = { imageEdit: undefined, variation: undefined, repaint: undefined, smartSelect: undefined }
    mocks.status.error = null
    mocks.status.refetch.mockReset()
  })

  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it.each(['smart-edit', 'relight', 'variation', 'fusion', 'retouch', 'repaint'])('%s 等待配置时不闪现未上线提示', async (tool) => {
    mocks.tool = tool
    const { container, rerender } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('正在加载功能配置…')
    expect(container.textContent).not.toContain('即将上线')
    expect(container.textContent).not.toContain('还不能用')
    expect((screen.getByRole('button', { name: /^生\s*成$/, hidden: true }) as HTMLButtonElement).disabled).toBe(true)

    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
    rerender(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('正在加载功能配置…')).toBeNull()
    expect(container.textContent).not.toContain('即将上线')
    expect(container.textContent).not.toContain('还不能用')
  })

  it('加载失败只显示重试，保留参数面板', () => {
    mocks.tool = 'variation'
    mocks.status.error = new Error('网络错误')
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('功能配置加载失败，请重试')
    expect(screen.getByText('补充要求（可选）')).toBeTruthy()
    expect(container.textContent).not.toContain('即将上线')
    fireEvent.click(screen.getByRole('button', { name: /^重\s*试$/, hidden: true }))
    expect(mocks.status.refetch).toHaveBeenCalledOnce()
  })

  it('确认裂变未配置后才显示未上线标签和能力提示', () => {
    mocks.tool = 'variation'
    mocks.status.capabilities.variation = false
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('裂变 · 即将上线')).toBeTruthy()
    expect(screen.getByText('该能力即将上线，目前还不能提交生成任务。')).toBeTruthy()
    expect(screen.queryByText('补充要求（可选）')).toBeNull()
  })

  it('确认重绘未配置后才显示不能用的提示', () => {
    mocks.tool = 'repaint'
    mocks.status.capabilities.repaint = false
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('重绘还不能用。请确认已开通万相 wanx2.1-imageedit，并配置 DASHSCOPE_API_KEY。')).toBeTruthy()
    expect(screen.getByText('重绘描述')).toBeTruthy()
  })
})
