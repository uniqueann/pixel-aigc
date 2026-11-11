import { describe, expect, it } from 'vitest'
import { OUTPAINT_IDLE_REASONS, UNAVAILABLE_SERVICE_MESSAGES, workstationGenerateBlockReason } from './generateGate'

const base = {
  toolReady: true,
  hasInput: true,
  formLocked: false,
  maskRequired: false,
  hasMaskPaint: false,
  repaintBlocked: false,
}

describe('工作站生成门禁', () => {
  it('零扩图时按自由/预设给出可执行的下一步', () => {
    expect(workstationGenerateBlockReason({ ...base, outpaintIdle: 'free' })).toBe(OUTPAINT_IDLE_REASONS.free)
    expect(workstationGenerateBlockReason({ ...base, outpaintIdle: 'preset' })).toBe(OUTPAINT_IDLE_REASONS.preset)
  })

  it('服务端限额预校验失败时直接显示原因', () => {
    expect(workstationGenerateBlockReason({ ...base, outpaintLimitError: '目标尺寸超出扩图服务可扩展范围' }))
      .toBe('目标尺寸超出扩图服务可扩展范围')
  })

  it('扩图有实际工作时不拦截', () => {
    expect(workstationGenerateBlockReason({ ...base })).toBeUndefined()
  })

  it('消除与重绘不可用用同一组文案，且重绘不再说「尚未配置」', () => {
    expect(workstationGenerateBlockReason({ ...base, removeBlocked: true })).toBe(UNAVAILABLE_SERVICE_MESSAGES.remove)
    expect(workstationGenerateBlockReason({ ...base, repaintBlocked: true })).toBe(UNAVAILABLE_SERVICE_MESSAGES.repaint)
    // 「尚未配置」像在怪用户，且与右卡 CapabilityStatus 的说法不一致。
    expect(UNAVAILABLE_SERVICE_MESSAGES.repaint).not.toContain('尚未配置')
    expect(UNAVAILABLE_SERVICE_MESSAGES.repaint).toContain('暂不可用')
  })
})
