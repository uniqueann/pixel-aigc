import { describe, expect, it } from 'vitest'
import { EMPTY_ERASE_MASK_MESSAGE, emptyMaskMessage, MIN_MASK_PIXELS, overlayDataHasPaint, remapMaskExportError } from './maskExport'
import { maskHasEraseRegion, thresholdPaintedOverlay } from '../../../../shared/erase'
import { workstationGenerateBlockReason } from './generateGate'

describe('蒙版导出提示', () => {
  it('按工具给出空蒙版文案', () => {
    expect(emptyMaskMessage('repaint')).toBe('请先涂抹要重绘的区域')
    expect(emptyMaskMessage('remove')).toBe(EMPTY_ERASE_MASK_MESSAGE)
  })

  it('把消除空蒙版错误改写成重绘提示', () => {
    const remapped = remapMaskExportError(new Error(EMPTY_ERASE_MASK_MESSAGE), 'repaint')
    expect(remapped).toBeInstanceOf(Error)
    expect((remapped as Error).message).toBe('请先涂抹要重绘的区域')
    expect(remapMaskExportError(new Error('蒙版画布尚未准备好'), 'repaint').message).toBe('蒙版画布尚未准备好')
  })
})

describe('智能选区也算已涂抹', () => {
  it('白色半透明贴图（约 48% 不透明）仍超过最小像素门槛', () => {
    const rgba = new Uint8Array(40 * 4)
    for (let index = 0; index < 40; index += 1) {
      rgba[index * 4] = 255
      rgba[index * 4 + 1] = 255
      rgba[index * 4 + 2] = 255
      rgba[index * 4 + 3] = 122
    }
    const overlay = thresholdPaintedOverlay(rgba, 40, 1)
    expect(overlayDataHasPaint(rgba, MIN_MASK_PIXELS)).toBe(true)
    expect(maskHasEraseRegion(overlay, undefined, MIN_MASK_PIXELS)).toBe(true)
  })

  it('画笔同色半透明红也算选区', () => {
    const rgba = new Uint8Array(40 * 4)
    for (let index = 0; index < 40; index += 1) {
      rgba[index * 4] = 220
      rgba[index * 4 + 1] = 38
      rgba[index * 4 + 2] = 38
      rgba[index * 4 + 3] = 128
    }
    expect(overlayDataHasPaint(rgba, MIN_MASK_PIXELS)).toBe(true)
    expect(Array.from(thresholdPaintedOverlay(rgba, 40, 1)).every(value => value === 255)).toBe(true)
  })
})

describe('生成按钮禁用原因', () => {
  it('加载中和请求失败不会提示能力即将上线', () => {
    const input = {
      toolReady: false, hasInput: true, formLocked: false,
      maskRequired: false, hasMaskPaint: false, repaintBlocked: false,
    }
    expect(workstationGenerateBlockReason({ ...input, configurationPending: true })).toBe('正在加载功能配置，请稍候')
    expect(workstationGenerateBlockReason({ ...input, configurationError: true })).toBe('功能配置加载失败，请重试')
  })
  it('有蒙版时可点生成，没有蒙版则给出涂抹提示', () => {
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: true,
      hasMaskPaint: true,
      repaintBlocked: false,
      mode: 'repaint',
    })).toBeUndefined()
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: true,
      hasMaskPaint: false,
      repaintBlocked: false,
      mode: 'repaint',
    })).toBe('请先涂抹要重绘的区域')
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: true,
      hasMaskPaint: false,
      repaintBlocked: false,
      mode: 'remove',
    })).toBe(EMPTY_ERASE_MASK_MESSAGE)
  })

  it('精修未选方向时不能生成', () => {
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: false,
      hasMaskPaint: false,
      repaintBlocked: false,
      retouchBlocked: true,
    })).toBe('请先选择精修方向')
  })

  it('参考图超过所选模型上限时不能生成', () => {
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: false,
      hasMaskPaint: false,
      repaintBlocked: false,
      referenceCount: 2,
      maxRefImages: 3,
    })).toBeUndefined()
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: false,
      hasMaskPaint: false,
      repaintBlocked: false,
      referenceCount: 4,
      maxRefImages: 3,
    })).toBe('当前模型最多 3 张参考图')
  })

  it('积分不足排在上传和涂抹之后', () => {
    const ready = {
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: false,
      hasMaskPaint: false,
      repaintBlocked: false,
    }
    expect(workstationGenerateBlockReason({ ...ready, insufficientCredits: true })).toBe('积分不足')
    expect(workstationGenerateBlockReason({ ...ready, hasInput: false, insufficientCredits: true })).toBe('请先上传需要处理的图片')
    expect(workstationGenerateBlockReason({
      ...ready,
      maskRequired: true,
      mode: 'remove',
      insufficientCredits: true,
    })).toBe(EMPTY_ERASE_MASK_MESSAGE)
  })

  it('融合缺图时不能生成', () => {
    expect(workstationGenerateBlockReason({
      toolReady: true,
      hasInput: false,
      formLocked: false,
      maskRequired: false,
      hasMaskPaint: false,
      repaintBlocked: false,
      fusionBlocked: true,
    })).toBe('请先上传商品图和场景图')
  })
})
