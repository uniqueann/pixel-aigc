import { describe, expect, it } from 'vitest'
import { IMAGE_MODEL_PROFILES, OPENROUTER_NANO_BANANA_PROFILE_ID, defaultImageModel, publicImageModel } from '@shared/image-models'
import type { BillingCatalog } from '@shared/billing'
import { Capability } from '@/types'
import { effectiveImageParameters } from '@/features/preferences/toolParameters'
import { DEFAULT_ASPECT_RATIO_SETTINGS, type BatchImage } from '@/pages/Toolbox/aspect-ratio/types'
import { creditQuote, creditQuoteLabel, imageCreditAmount, outpaintCreditAmount, positiveQuoteCount } from './quotes'
import { aspectRatioBatchQuote, bgRemoveBatchQuote } from './batchQuotes'
import { workstationRequestQuote } from '@/features/image-workstation/creditQuote'

const model = publicImageModel(defaultImageModel('image_edit')!)
const catalog: BillingCatalog = { currency: 'USD', providers: [], packs: [], balance: 100, paymentBlocked: false, priceVersion: 'v1', freeBgRemoveMonth: '2026-10', freeBgRemoveRemaining: 1 }
const item = (id: string, patch: Partial<BatchImage> = {}): BatchImage => ({
  id, file: new File(['source'], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png', sourceUrl: '', width: 800, height: 400, status: 'pending', ...patch,
})

describe('操作报价与实际提交参数', () => {
  it('按有效张数和分辨率报价，4K降级时不收4K价格', () => {
    const effective = effectiveImageParameters(2, '4k', { width: 1000, height: 1000 }, model.ui)
    expect(effective.resolution).toBe('2k')
    expect(imageCreditAmount(model, effective.count, effective.resolution)).toBe(12)
    expect(imageCreditAmount(model, 3, '1k')).toBe(12)
  })

  it('Nano Banana 2.1 按 1K/2K/4K 显示 4/6/14，正方形 4K 不降级', () => {
    const nano = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === OPENROUTER_NANO_BANANA_PROFILE_ID)!)
    expect(imageCreditAmount(nano, 1, '1k')).toBe(4)
    expect(imageCreditAmount(nano, 1, '2k')).toBe(6)
    expect(imageCreditAmount(nano, 1, '4k')).toBe(14)
    expect(imageCreditAmount(nano, 2, '2k')).toBe(12)
    const effective = effectiveImageParameters(1, '4k', { width: 1000, height: 1000 }, nano.ui)
    expect(effective.resolution).toBe('4k')
    expect(imageCreditAmount(nano, effective.count, effective.resolution)).toBe(14)
  })

  it('未上传导致有效张数为 0 时，报价改用当前选择的张数', () => {
    expect(positiveQuoteCount(0, 2)).toBe(2)
    expect(positiveQuoteCount(Number.NaN, 3)).toBe(3)
    expect(positiveQuoteCount(4, 1)).toBe(4)
    expect(positiveQuoteCount(0, 0)).toBeUndefined()
    expect(imageCreditAmount(model, positiveQuoteCount(0, 1) ?? 0, '1k')).toBe(4)
    expect(imageCreditAmount(model, positiveQuoteCount(0, 2) ?? 0, '1k')).toBe(8)
    expect(imageCreditAmount(model, positiveQuoteCount(1, 2) ?? 0, '2k')).toBe(6)
  })

  it('缺失、非法报价和未知模型不能成为零积分', () => {
    const missing = { ...model, pricing: { ...model.pricing, creditsPerImage: {} } }
    for (const amount of [undefined, NaN, Infinity, -1]) expect(creditQuote(amount)).toEqual({ status: 'unavailable' })
    expect(imageCreditAmount(missing, 1, '2k')).toBeUndefined()
    expect(workstationRequestQuote({ capability: Capability.ImageEdit, modelProfileId: 'old-model', params: { count: 2, resolution: '1k' } }, [model])).toEqual({ status: 'unavailable' })
  })

  it('工作站重试按原请求报价，不借用当前草稿参数', () => {
    expect(workstationRequestQuote({ capability: Capability.ImageEdit, modelProfileId: model.id, params: { count: 3, resolution: '1k' } }, [model])).toMatchObject({ status: 'ready', credits: 12 })
    expect(workstationRequestQuote({ capability: Capability.Inpaint, params: {} }, [])).toMatchObject({ credits: 5 })
  })

  it('扩图按整数几何报价，无留白免费，一轮5分，两轮10分', () => {
    const sourceSize = { width: 1000, height: 1000 }
    expect(outpaintCreditAmount({ sourceSize, targetSize: sourceSize, originOffset: { x: 0, y: 0 } })).toBe(0)
    expect(outpaintCreditAmount({ sourceSize, targetSize: { width: 2000, height: 1000 }, originOffset: { x: 500, y: 0 } })).toBe(5)
    expect(outpaintCreditAmount({ sourceSize, targetSize: { width: 4000, height: 4000 }, originOffset: { x: 1500, y: 1500 } })).toBe(10)
    expect(workstationRequestQuote({ capability: Capability.Outpaint, params: { sourceSize, targetSize: sourceSize, originOffset: { x: 0, y: 0 } } }, [], { mock: true })).toMatchObject({ status: 'ready', credits: 0 })
  })
})

describe('批量报价', () => {
  it('抠图跳过完成项和已有透明结果，只扣除本次供应商请求的免费额度', () => {
    const images = [item('done', { status: 'succeeded' }), item('new'), item('failed', { status: 'failed' }), { ...item('compose-failed', { status: 'failed' }), matte: new Blob(['matte']) }]
    expect(bgRemoveBatchQuote(images, catalog)).toMatchObject({ credits: 1, maximum: true })
    expect(bgRemoveBatchQuote(images, catalog, { ids: ['failed'] })).toMatchObject({ credits: 0, estimatedFree: true })
    expect(bgRemoveBatchQuote(images, undefined, { ids: ['compose-failed'] })).toMatchObject({ credits: 0 })
    expect(bgRemoveBatchQuote(images, undefined)).toEqual({ status: 'unavailable' })
  })

  it('批量转比例只累计在线扩图，单项重试不算整批', () => {
    const images = [item('local', { width: 800, height: 800 }), item('remote'), item('done', { status: 'succeeded' })]
    const settings = { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'outpaint' as const }
    expect(aspectRatioBatchQuote(images, settings, 1600, 1600)).toMatchObject({ credits: 5 })
    expect(aspectRatioBatchQuote(images, settings, 1600, 1600, { ids: ['local'] })).toMatchObject({ credits: 0 })
    expect(aspectRatioBatchQuote(images, { ...settings, strategy: 'crop' }, 1600, 1600)).toMatchObject({ credits: 0 })
  })

  it('免费、预计免费、最高费用和模拟状态使用不同文案', () => {
    expect(creditQuoteLabel(creditQuote(0))).toBe('免费')
    expect(creditQuoteLabel(creditQuote(0, { estimatedFree: true }))).toBe('预计免费')
    expect(creditQuoteLabel(creditQuote(10, { maximum: true }))).toBe('最多 10 积分')
    expect(creditQuoteLabel(creditQuote(undefined, { mock: true }))).toBe('模拟，不扣积分')
  })
})
