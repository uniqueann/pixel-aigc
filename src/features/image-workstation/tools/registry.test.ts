import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import {
  getWorkstationTool,
  isWorkstationToolReady,
  workstationDisplaysSourcePreview,
} from './registry'

describe('图片工作站工具开关', () => {
  it('扩图、消除和重绘始终可提交，其它工具跟随任务能力开关', () => {
    expect(isWorkstationToolReady(getWorkstationTool('outpaint'), () => false)).toBe(true)
    expect(isWorkstationToolReady(getWorkstationTool('remove'), () => false)).toBe(true)
    expect(isWorkstationToolReady(getWorkstationTool('repaint'), () => false)).toBe(true)
    expect(isWorkstationToolReady(getWorkstationTool('smart-edit'), () => false)).toBe(false)
    expect(isWorkstationToolReady(getWorkstationTool('relight'), () => false)).toBe(false)
    expect(isWorkstationToolReady(getWorkstationTool('fusion'), () => false)).toBe(false)
    expect(isWorkstationToolReady(getWorkstationTool('variation'), () => false)).toBe(false)
    expect(isWorkstationToolReady(getWorkstationTool('retouch'), () => false)).toBe(false)
    expect(isWorkstationToolReady(getWorkstationTool('smart-edit'), () => true)).toBe(true)
    expect(isWorkstationToolReady(getWorkstationTool('variation'), (capability) => capability === Capability.Variation)).toBe(true)
    expect(isWorkstationToolReady(getWorkstationTool('retouch'), (capability) => capability === Capability.Retouch)).toBe(true)
    expect(isWorkstationToolReady(getWorkstationTool('fusion'), (capability) => capability === Capability.Fusion)).toBe(true)
  })

  it('融合不展示上一工具的单图预览', () => {
    expect(workstationDisplaysSourcePreview('multi-source')).toBe(false)
    expect(workstationDisplaysSourcePreview('params-only')).toBe(true)
    expect(workstationDisplaysSourcePreview('mask-paint')).toBe(true)
    expect(workstationDisplaysSourcePreview('light-control')).toBe(true)
  })
})
