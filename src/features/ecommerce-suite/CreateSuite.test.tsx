// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from 'antd'
import { CloudError } from '@/cloud/client'
import type { SuiteClient } from './api'
import CreateSuite from './CreateSuite'
import { readSuiteCreation, saveSuiteCreation } from './backup'

vi.mock('./backup', () => ({ readSuiteCreation: vi.fn(), saveSuiteCreation: vi.fn(async () => undefined) }))
vi.mock('@shared/image-format', () => ({ normalizeImageBlob: vi.fn(async (blob: Blob) => blob) }))
vi.mock('@/services/api/ownedImages', () => ({ readOwnedImage: vi.fn() }))
vi.mock('@/features/free-canvas/images/CanvasAssetPicker', () => ({ default: () => null }))

const contract = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const actor = contract.project.actor
const config = contract.project.config
const requestId = '00000000-0000-4000-8000-000000000055'
const projectId = '00000000-0000-4000-8000-000000000066'
const image = new Blob(['合成图片'], { type: 'image/png' })

describe('新建套图的创建编号', () => {
  beforeEach(() => {
    vi.mocked(readSuiteCreation).mockResolvedValue({ requestId, config, image })
    vi.mocked(saveSuiteCreation).mockResolvedValue(undefined)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:mock') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('恢复草稿后修改资料，提交仍复用原创建编号，避免重复项目', async () => {
    const create = vi.fn<(requestId: string, nextConfig: typeof config) => Promise<{ id: string; config: typeof config }>>(async () => ({ id: projectId, config }))
    const upload = vi.fn(async () => ({}))
    const onCreated = vi.fn()
    const client = { assertCurrent: () => undefined, create, findCreate: vi.fn(async () => null), upload } as unknown as SuiteClient

    render(<CreateSuite actor={actor} client={client} onClose={() => undefined} onCreated={onCreated} />)

    // 草稿恢复后才有底图，才能进入第二步。
    const next = await screen.findByRole('button', { name: '下一步：设置商品信息' }) as HTMLButtonElement
    await waitFor(() => expect(next.disabled).toBe(false))
    fireEvent.click(next)
    const title = await screen.findByLabelText('商品名称')
    await waitFor(() => expect((title as HTMLInputElement).value).toBe(config.title))

    fireEvent.change(screen.getByLabelText('商品名称'), { target: { value: '修改后的标题' } })
    fireEvent.click(screen.getByRole('button', { name: '创建并进入工作台' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    // 修改资料不能换编号：旧编号若已在服务端创建成功，换号会产生第二个项目。
    expect(create.mock.calls[0][0]).toBe(requestId)
    expect(create.mock.calls[0][1]).toMatchObject({ title: '修改后的标题' })
    expect(onCreated).toHaveBeenCalledWith(projectId)
  })

  it('找回项目后底图编号已被上次的图片占用时，保留原图并进入工作台', async () => {
    const create = vi.fn<(requestId: string, nextConfig: typeof config) => Promise<{ id: string; config: typeof config }>>(async () => {
      throw new CloudError(409, '创建请求已用于其他配置', 'SUITE_REQUEST_CONFLICT')
    })
    const findCreate = vi.fn(async () => ({ id: projectId, config }))
    const upload = vi.fn(async () => { throw new CloudError(409, '上传编号已用于其他图片', 'SUITE_REQUEST_CONFLICT') })
    const onCreated = vi.fn()
    const client = { assertCurrent: () => undefined, create, findCreate, upload } as unknown as SuiteClient

    // App 提供 message 上下文，恢复提示与保留原图提示都依赖它。
    render(<App><CreateSuite actor={actor} client={client} onClose={() => undefined} onCreated={onCreated} /></App>)
    const next = await screen.findByRole('button', { name: '下一步：设置商品信息' }) as HTMLButtonElement
    await waitFor(() => expect(next.disabled).toBe(false))
    fireEvent.click(next)
    await screen.findByLabelText('商品名称')
    fireEvent.click(screen.getByRole('button', { name: '创建并进入工作台' }))

    // 底图编号已被旧图占用说明项目本身已创建成功，不能因此把用户困在创建弹窗里。
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(projectId))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(saveSuiteCreation).toHaveBeenLastCalledWith(actor, undefined)
    expect(await screen.findByText('原项目已保留上次的商品主体图，本次选择的图片未上传；进入工作台后可替换主体图')).toBeTruthy()
  })
})
