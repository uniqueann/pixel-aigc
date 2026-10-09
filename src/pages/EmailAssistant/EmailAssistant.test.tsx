// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react'
import { App, Modal } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import { useTaskStore } from '@/store/useTaskStore'
import { EMAIL_BATCH_HEADERS } from '@/features/email-assistant/options'
import EmailAssistant from './index'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ submit: vi.fn(), find: vi.fn(), get: vi.fn(), copy: vi.fn(), download: vi.fn(), list: vi.fn(), auth: false }))
vi.mock('@/cloud/client', () => ({ get authEnabled() { return mocks.auth } }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useOutletContext: () => ({ openModelSettings: vi.fn() }) }))
vi.mock('@/services/api/task', () => ({
  createTask: mocks.submit, findTaskByRequest: mocks.find, getTaskByRequest: mocks.find, getTask: mocks.get,
  saveTaskEdit: vi.fn(), listTasks: mocks.list, deleteTask: vi.fn(),
}))
vi.mock('@/features/model-settings/useModelSettings', () => ({
  useModelSettings: () => ({
    settingsQuery: { data: { defaultEmailModelId: 'deepseek:用户默认模型' }, error: null },
    profilesQuery: { data: { items: [{ id: 'deepseek:用户默认模型', label: '用户默认模型', available: true, credits: 1, priceVersion: 'aigc-email-v1' }] }, error: null },
  }),
}))

const completed = (id = '已完成邮件'): GenerationTask<unknown> => ({
  id, capability: Capability.EmailAssist, status: 'succeeded', params: { sourceText: '客户邮件', operation: 'reply', language: 'zh' },
  resultText: '建议回复内容', creditsCost: 0, createdAt: '2026-10-04', updatedAt: '2026-10-04',
})
const clickMode = (name: string) => fireEvent.click(screen.getByText(name, { selector: '.ant-segmented-item-label' }))
function batchPane() { return within(document.querySelector('.email-batch-panel') as HTMLElement) }
function buttonByText(container: ReturnType<typeof within>, name: RegExp) {
  const button = container.getByText(name).closest('button')
  if (!button) throw new Error('未找到按钮')
  return button
}
async function importCsv(lines: string[]) {
  const content = EMAIL_BATCH_HEADERS.join(',') + '\n' + lines.join('\n')
  const file = new File([content], '客户邮件.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer })
  fireEvent.change(document.querySelector('.email-batch-panel input[type="file"]')!, { target: { files: [file] } })
  await waitFor(() => expect(batchPane().getByText(/当前文件：客户邮件.csv/)).toBeTruthy())
}

describe('邮件助手单个与批量页面', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode
  let entry: string
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    // jsdom 不支持伪元素样式，保留普通元素的计算样式供表格测量使用。
    const computedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element))
    mocks.submit.mockReset().mockResolvedValue(completed())
    mocks.auth = false
    mocks.list.mockReset().mockResolvedValue({ items: [], total: 0 })
    mocks.find.mockReset().mockResolvedValue(undefined)
    mocks.get.mockReset().mockResolvedValue(completed())
    mocks.copy.mockReset().mockResolvedValue(undefined)
    mocks.download.mockReset()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.copy } })
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL() { return 'blob:批量测试' }
      static revokeObjectURL() {}
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { mocks.download(this.download) })
    useUserStore.setState({ userId: '账号一', account: null })
    useTaskStore.setState({ tasks: {} })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    entry = '/email'
    wrapper = ({ children }) => <StrictMode><MemoryRouter initialEntries={[entry]}><QueryClientProvider client={client}><App>{children}</App></QueryClientProvider></MemoryRouter></StrictMode>
  })
  afterEach(() => { Modal.destroyAll(); cleanup(); client?.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useUserStore.setState({ userId: null }) })

  function EntryControls() {
    const navigate = useNavigate(), location = useLocation()
    return <><output data-testid="entry-url">{location.search}</output><button onClick={() => navigate('/email?mode=single&operation=summarize')}>快捷总结</button></>
  }

  it('批量快捷入口直接显示批量，单个快捷入口预选操作且消耗一次性参数', async () => {
    entry = '/email?mode=batch'
    const first = render(<><EmailAssistant /><EntryControls /></>, { wrapper })
    expect(document.querySelector('.email-batch-panel')?.parentElement?.hidden).toBe(false)
    first.unmount()
    entry = '/email?mode=single&operation=grammar'
    render(<><EmailAssistant /><EntryControls /></>, { wrapper })
    await waitFor(() => expect(screen.getByTestId('entry-url').textContent).toBe('?mode=single'))
    expect(document.querySelector('.email-single-panel input[value="grammar"]')).toHaveProperty('checked', true)
    expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('value', '')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('同页选择快捷操作清空表单，正在生成时保留原始输入', async () => {
    render(<><EmailAssistant /><EntryControls /></>, { wrapper })
    fireEvent.change(screen.getByPlaceholderText('粘贴需要处理的邮件内容'), { target: { value: '上一封邮件' } })
    fireEvent.click(screen.getByText('快捷总结'))
    await waitFor(() => expect(document.querySelector('.email-single-panel input[value="summarize"]')).toHaveProperty('checked', true))
    expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('value', '')
    let resolve!: (task: GenerationTask<unknown>) => void
    mocks.submit.mockReturnValueOnce(new Promise(done => { resolve = done }))
    fireEvent.change(screen.getByPlaceholderText('粘贴需要处理的邮件内容'), { target: { value: '正在处理的邮件' } })
    fireEvent.click(buttonByText(within(document.querySelector('.email-single-panel') as HTMLElement), /^生\s*成$/))
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('快捷总结'))
    await waitFor(() => expect(screen.getByTestId('entry-url').textContent).toBe('?mode=single'))
    expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('value', '正在处理的邮件')
    await act(async () => { resolve(completed()); await Promise.resolve() })
  })

  it('显式快捷入口不会被迟到历史覆盖，普通入口仍恢复最新任务', async () => {
    mocks.auth = true
    let resolve!: (value: unknown) => void
    mocks.list.mockReturnValueOnce(new Promise(done => { resolve = done }))
    entry = '/email?mode=single&operation=grammar'
    const first = render(<EmailAssistant />, { wrapper })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))
    await act(async () => { resolve({ items: [completed()], total: 1 }); await Promise.resolve() })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(document.querySelector('.email-single-panel input[value="grammar"]')).toHaveProperty('checked', true)
    expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('value', '')
    expect(within(document.querySelector('.email-single-panel') as HTMLElement).getByText('用户默认模型 · 1 积分')).toBeTruthy()
    expect(within(document.querySelector('.email-single-panel') as HTMLElement).queryByRole('combobox', { name: '本次使用的模型' })).toBeNull()
    first.unmount()
    entry = '/email'
    mocks.list.mockResolvedValue({ items: [completed()], total: 1 })
    render(<EmailAssistant />, { wrapper })
    await waitFor(() => expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('value', '客户邮件'))
    expect(mocks.get).toHaveBeenCalledWith('已完成邮件')
  })

  it('默认单个模式，页签切换保留单个输入和批量预览', async () => {
    render(<EmailAssistant />, { wrapper })
    fireEvent.change(screen.getByPlaceholderText('粘贴需要处理的邮件内容'), { target: { value: '保留原始邮件' } })
    fireEvent.change(screen.getByPlaceholderText('告诉 AI 想要表达的重点，例如：委婉说明发货延迟'), { target: { value: '保留编写指导' } })
    clickMode('批量')
    await importCsv(['批量邮件,,,'])
    clickMode('单个')
    expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('value', '保留原始邮件')
    expect(screen.getByPlaceholderText('告诉 AI 想要表达的重点，例如：委婉说明发货延迟')).toHaveProperty('value', '保留编写指导')
    clickMode('批量')
    expect(batchPane().getByText('批量邮件')).toBeTruthy()
  })

  it('只提交有效行，使用账号默认模型，并展示结果详情及复制', async () => {
    render(<EmailAssistant />, { wrapper })
    clickMode('批量')
    await importCsv(['有效邮件,重点日期,总结,en', ',指导,回复,中文'])
    fireEvent.click(buttonByText(batchPane(), /^生成 \d+ 条$/))
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')).toBeTruthy())
    fireEvent.click(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')!)
    await waitFor(() => expect(batchPane().getByText('成功')).toBeTruthy())
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({ modelProfileId: 'deepseek:用户默认模型', params: {
      sourceText: '有效邮件', instruction: '重点日期', operation: 'summarize', language: 'en',
    } }), { signal: expect.any(AbortSignal) })
    expect(batchPane().getByText('填写错误')).toBeTruthy()
    expect(batchPane().getByText('序号')).toBeTruthy()
    expect(batchPane().getByText('第 2 条（CSV 第 3 行）填写错误，只生成有效行；请修正 CSV 后重新上传。')).toBeTruthy()
    expect(batchPane().getByText('第 2 条（CSV 第 3 行）：原始邮件内容不能为空')).toBeTruthy()
    fireEvent.click(batchPane().getAllByText('详情')[0])
    expect(screen.getByText('第 1 条（CSV 第 2 行）')).toBeTruthy()
    fireEvent.click(screen.getByText('复制生成结果'))
    await waitFor(() => expect(mocks.copy).toHaveBeenCalledWith('建议回复内容'))
  })

  it('生成期间切换到单个会锁定生成按钮，暂停后保留剩余行', async () => {
    let resolve!: (task: GenerationTask<unknown>) => void
    mocks.submit.mockReturnValueOnce(new Promise(done => { resolve = done }))
    render(<EmailAssistant />, { wrapper })
    fireEvent.change(screen.getByPlaceholderText('粘贴需要处理的邮件内容'), { target: { value: '单个邮件' } })
    clickMode('批量')
    await importCsv(['邮件一,,,', '邮件二,,,'])
    fireEvent.click(buttonByText(batchPane(), /^生成 \d+ 条$/))
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')).toBeTruthy())
    fireEvent.click(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')!)
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    clickMode('单个')
    const singlePane = within(document.querySelector('.email-single-panel') as HTMLElement)
    expect(buttonByText(singlePane, /^生\s*成$/).disabled).toBe(true)
    expect(screen.getByPlaceholderText('粘贴需要处理的邮件内容')).toHaveProperty('disabled', false)
    clickMode('批量')
    fireEvent.click(buttonByText(batchPane(), /^暂\s*停$/))
    await act(async () => { resolve(completed()); await Promise.resolve() })
    await waitFor(() => expect(buttonByText(batchPane(), /继续生成/).disabled).toBe(false))
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(batchPane().getByText(/共 2 条 · 待处理 1/)).toBeTruthy()
  })

  it('账号切换会清空批次，旧账号迟到响应不会写入任务状态', async () => {
    let resolve!: (task: GenerationTask<unknown>) => void
    mocks.submit.mockReturnValueOnce(new Promise(done => { resolve = done }))
    render(<EmailAssistant />, { wrapper })
    clickMode('批量')
    await importCsv(['旧账号邮件一,,,', '旧账号邮件二,,,'])
    fireEvent.click(buttonByText(batchPane(), /^生成 \d+ 条$/))
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')).toBeTruthy())
    fireEvent.click(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')!)
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    act(() => useUserStore.getState().setUser('账号二', 'free'))
    clickMode('批量')
    expect(batchPane().queryByText('旧账号邮件一')).toBeNull()
    await act(async () => { resolve(completed('旧账号任务')); await Promise.resolve() })
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    expect(useTaskStore.getState().tasks['旧账号任务']).toBeUndefined()
  })

  it('可下载模板和包含所有行的结果 CSV，清空后导出不可用', async () => {
    render(<EmailAssistant />, { wrapper })
    clickMode('批量')
    fireEvent.click(buttonByText(batchPane(), /下载模板/))
    expect(mocks.download).toHaveBeenCalledWith('邮件助手-批量模板.csv')
    expect(batchPane().getByAltText('CSV 模板列名：原始邮件内容、编写指导、生成设置、语言')).toBeTruthy()
    await importCsv(['未生成的邮件,,,', ',错误行,,'])
    fireEvent.click(buttonByText(batchPane(), /导出 CSV/))
    expect(mocks.download).toHaveBeenCalledWith('客户邮件-生成结果.csv')
    fireEvent.click(buttonByText(batchPane(), /清空批次/))
    expect(buttonByText(batchPane(), /导出 CSV/).disabled).toBe(true)
  })

  it('确认框关闭后批次在后台跑，暂停期间不提交、继续后接着跑', async () => {
    let resolveFirst!: (task: GenerationTask<unknown>) => void
    mocks.submit.mockReturnValueOnce(new Promise<GenerationTask<unknown>>(done => { resolveFirst = done }))
    render(<EmailAssistant />, { wrapper })
    clickMode('批量')
    await importCsv(['邮件一,,,', '邮件二,,,', '邮件三,,,'])
    fireEvent.click(buttonByText(batchPane(), /^生成 \d+ 条$/))
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')).toBeTruthy())
    fireEvent.click(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')!)
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1))
    // 批次仍在跑：确认框必须已经关闭，不能盖住「暂停」按钮
    expect(document.querySelector('.ant-modal-confirm .ant-btn-loading')).toBeNull()
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm')).toBeNull())
    // 暂停：等当前条完成后，不再提交新邮件
    fireEvent.click(buttonByText(batchPane(), /^暂\s*停$/))
    await act(async () => { resolveFirst(completed()); await Promise.resolve() })
    await waitFor(() => expect(batchPane().getByText(/共 3 条 · 待处理 2/)).toBeTruthy())
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    // 继续：从剩下的条目接着跑
    fireEvent.click(buttonByText(batchPane(), /继续生成/))
    await waitFor(() => expect(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')).toBeTruthy())
    fireEvent.click(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')!)
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(batchPane().getByText(/成功 3/)).toBeTruthy())
  })
})
