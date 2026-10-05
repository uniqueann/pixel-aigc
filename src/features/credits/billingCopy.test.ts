import { describe, expect, it } from 'vitest'
import { BG_REMOVE_MONTHLY_FREE, SYNC_TOOL_LABELS, syncCreditPrice } from '@shared/billing'
import { IMAGE_MODEL_PROFILES } from '@shared/image-models'
import { MAX_EXPAND_PASSES, MAX_SCALE } from '@shared/outpaint'
import { SEEDANCE_VIDEO_MODEL } from '@shared/video-models'
import { LOCAL_TEMPLATE_LABEL } from '@/pages/Toolbox/shared/presetLabels'
import { SUBJECT_DETECTION_LABEL } from '@/pages/Toolbox/aspect-ratio/subjectLabels'
import { SMART_SELECT_LABEL } from '@/services/api/smartSelectLabels'
import { billingExplanationCopy, formatBillingMonth } from './billingCopy'

function flat(remaining: number, month = '2026-10') {
  const copy = billingExplanationCopy({ freeBgRemoveRemaining: remaining, freeBgRemoveMonth: month })
  return { copy, text: copy.groups.flatMap(group => [group.title, ...group.items]).join('\n') }
}

describe('计费说明文案', () => {
  it('摘要使用实时剩余额度，明细使用计费常量', () => {
    const { copy, text } = flat(18)
    const profile = IMAGE_MODEL_PROFILES.find(item => item.enabled)
    expect(profile?.pricing.creditsPerImage).toMatchObject({ '1k': expect.any(Number), '2k': expect.any(Number), '4k': expect.any(Number) })
    expect(copy.summary).toBe(`按功能扣分，${SYNC_TOOL_LABELS['bg-remove']}本月还可免费 18 张`)
    expect(copy.groups.map(group => group.title)).toEqual(['生成类', '编辑类', '抠图与工具', '预扣与退还'])
    expect(text).toContain(`1K／2K／4K 分别扣 ${profile!.pricing.creditsPerImage['1k']}／${profile!.pricing.creditsPerImage['2k']}／${profile!.pricing.creditsPerImage['4k']} 分`)
    expect(text).toContain('按输出分辨率每张计费')
    expect(text).toContain('提交时按请求张数预扣，成功后只结算成功的张数')
    expect(text).toContain(`按 2K 的 ${profile!.pricing.creditsPerImage['2k']} 分扣`)
    expect(text).toContain(`${SEEDANCE_VIDEO_MODEL.pricing.creditsPerVideo[5]}`)
    expect(text).toContain(`${SEEDANCE_VIDEO_MODEL.pricing.creditsPerVideo[10]}`)
    expect(text).toContain(`${SYNC_TOOL_LABELS.erase}、${SYNC_TOOL_LABELS.repaint}每次 ${syncCreditPrice('erase')} 分`)
    expect(text).toContain(`1 轮 ${syncCreditPrice('outpaint', 1)} 分，${MAX_EXPAND_PASSES} 轮 ${syncCreditPrice('outpaint', MAX_EXPAND_PASSES)} 分`)
    expect(text).toContain(`${MAX_SCALE} 倍`)
    expect(text).toContain(`免费 ${BG_REMOVE_MONTHLY_FREE} 张`)
    expect(text).toContain('2026年10月还可免费 18 张')
    expect(text).toContain(`超出免费额度后每张 ${syncCreditPrice('bg-remove')} 分`)
    expect(text).toContain(SUBJECT_DETECTION_LABEL)
    expect(text).toContain(SMART_SELECT_LABEL)
    expect(text).toContain(LOCAL_TEMPLATE_LABEL)
    expect(text).toContain('失败或超时会退回预扣积分')
    expect(text).toContain('截止时间之后才送到的结果不再扣分')
    expect(text).toContain('视频任务失败或超时会退回预扣积分')
    expect(formatBillingMonth('2026-10')).toBe('2026年10月')
  })

  it('剩余额度变化时不沿用上一次的数字', () => {
    const first = flat(18).copy.summary
    const second = flat(0, '2026-11')
    expect(first).toContain('18')
    expect(second.copy.summary).toBe(`按功能扣分，${SYNC_TOOL_LABELS['bg-remove']}本月还可免费 0 张`)
    expect(second.text).toContain('2026年11月还可免费 0 张')
    expect(second.text).not.toContain('免费 18 张')
  })
})
