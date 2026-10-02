// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, publicImageModel } from '@shared/image-models'
import type { PublicImageModel } from '@/services/api/imageModels'
import { useUserStore } from '@/store/useUserStore'
import { useCanvasTextToImageConfiguration, useCanvasVariationConfiguration } from './availability'
import { useCanvasTextToImageModels, useCanvasVariationModels } from './useCanvasVariationModels'

const mocks = vi.hoisted(() => ({ flags: vi.fn(), models: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: false }))
vi.mock('@/services/api/capabilities', () => ({ loadCapabilityFlags: mocks.flags }))
vi.mock('@/services/api/imageModels', () => ({ listImageModels: mocks.models }))

const model = publicImageModel(defaultImageModel('text_to_image')!)

describe('自由画布图片模型读取', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GENERATION_MODE', 'real')
    vi.resetAllMocks()
    useUserStore.setState({ userId: 'owner-a' })
    useCanvasVariationConfiguration.setState({ ready: false, loading: true, models: [], error: undefined })
    useCanvasTextToImageConfiguration.setState({ ready: false, loading: true, models: [], error: undefined })
    mocks.flags.mockResolvedValue({ variation: false, textToImage: true })
    mocks.models.mockResolvedValue([model])
  })

  afterEach(() => {
    cleanup()
    useUserStore.setState({ userId: null })
    vi.unstubAllEnvs()
  })

  it('独立请求文生图和裂变模型，能力旗标不会交叉开放', async () => {
    const { result } = renderHook(() => ({ text: useCanvasTextToImageModels(), variation: useCanvasVariationModels() }))
    await waitFor(() => expect(result.current.text.loading).toBe(false))
    expect(mocks.models).toHaveBeenCalledWith('text_to_image')
    expect(mocks.models).toHaveBeenCalledWith('variation')
    expect(result.current.text.ready).toBe(true)
    expect(result.current.variation.ready).toBe(false)
  })

  it('配置失败后可重试，空模型和不匹配模型不会开放入口', async () => {
    mocks.models.mockRejectedValueOnce(new Error('模型读取失败'))
    const { result } = renderHook(() => useCanvasTextToImageModels())
    await waitFor(() => expect(result.current.error).toBe('模型读取失败'))
    expect(result.current.ready).toBe(false)
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.error).toBeUndefined()
    mocks.models.mockResolvedValueOnce([{ ...model, operations: ['variation'] }])
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.models).toEqual([])
    expect(result.current.ready).toBe(false)
  })

  it('切换账号后忽略旧账号迟到的配置响应', async () => {
    let finishOld!: (models: PublicImageModel[]) => void
    mocks.models.mockImplementationOnce(() => new Promise<PublicImageModel[]>(resolve => { finishOld = resolve }))
    const { result } = renderHook(() => useCanvasTextToImageModels())
    mocks.models.mockResolvedValueOnce([{ ...model, id: 'owner-b-model' }])
    act(() => useUserStore.setState({ userId: 'owner-b' }))
    await waitFor(() => expect(result.current.models[0]?.id).toBe('owner-b-model'))
    await act(async () => finishOld([{ ...model, id: 'owner-a-model' }]))
    expect(result.current.models[0]?.id).toBe('owner-b-model')
  })

  it('最新重载响应优先于更早发起的请求', async () => {
    let finishOld!: (models: PublicImageModel[]) => void
    mocks.models.mockImplementationOnce(() => new Promise<PublicImageModel[]>(resolve => { finishOld = resolve }))
    const { result } = renderHook(() => useCanvasTextToImageModels())
    mocks.models.mockResolvedValueOnce([{ ...model, id: 'new-model' }])
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.models[0]?.id).toBe('new-model'))
    await act(async () => finishOld([{ ...model, id: 'old-model' }]))
    expect(result.current.models[0]?.id).toBe('new-model')
  })

  it('模拟网关无需访问真实接口，文生图和裂变均可独立就绪', async () => {
    vi.stubEnv('VITE_GENERATION_MODE', 'mock')
    const { result } = renderHook(() => ({ text: useCanvasTextToImageModels(), variation: useCanvasVariationModels() }))
    await waitFor(() => expect(result.current.text.ready).toBe(true))
    expect(result.current.variation.ready).toBe(true)
    expect(mocks.models).not.toHaveBeenCalled()
    expect(mocks.flags).not.toHaveBeenCalled()
  })
})
