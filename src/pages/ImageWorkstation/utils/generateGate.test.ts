import { describe, expect, it } from 'vitest'
import { OUTPAINT_IDLE_REASONS, workstationGenerateBlockReason } from './generateGate'

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
})
