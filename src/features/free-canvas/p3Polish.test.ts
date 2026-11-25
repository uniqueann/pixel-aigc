import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const textPanel = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/generation/GenerationPanel.tsx'), 'utf8')
const strip = readFileSync(resolve(process.cwd(), 'src/components/PreviewResultStrip.tsx'), 'utf8')

const zhCommon = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/zh-CN/common.json'), 'utf8'))
const zhCanvas = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/zh-CN/canvas.json'), 'utf8'))

describe('画布 P3 收口接线', () => {
  it('占位框的时长文案来自共享模块，且只有进行中才跑秒级计时器', () => {
    expect(stageSource).toContain("from './generation/placeholderCopy'")
    expect(stageSource).toContain('placeholderDetail(generations[node.generationId]?.status, generations[node.generationId], Date.now(), phase)')
    // 视频阶段要透传到占位框（"视频转存中"这段最容易让人以为卡死）。
    expect(stageSource).toContain('taskPhase?.generationId === node.generationId ? taskPhase.phase : undefined')
    expect(stageSource).toContain('const hasActiveGeneration = useMemo')
    expect(stageSource).toContain('if (!hasActiveGeneration) return')
    expect(stageSource).toContain('window.setInterval(() => setGenerationTick((tick) => tick + 1), 1000)')
    // 改文字不重建对象，所以占位框必须关掉缓存，否则会被旧的组包围盒裁掉。
    expect(stageSource).toContain('objectCaching: false')
  })

  it('结果条说明这些缩略图已经在画布上，避免看起来是第二份结果', () => {
    expect(strip).toContain('preview-result-caption')
    expect(strip).toContain("t('preview.onCanvasCaption'")
    expect(zhCommon.preview.onCanvasCaption).toContain('已在画布上')
    expect(zhCommon.preview.onCanvasCaption).toContain('点缩略图可放大或下载')
  })

  it('比例选择器下面直接写出含义与像素，不用悬停 tooltip', () => {
    expect(textPanel).toContain('const activePreset = IMAGE_SIZE_PRESETS.find')
    expect(textPanel).toContain('free-canvas-field-hint')
    expect(textPanel).toContain("t('panel.ratioHint'")
    expect(textPanel).toContain('width: activePreset.width, height: activePreset.height')
    expect(zhCanvas.panel.ratioHint).toContain('{{width}}×{{height}}')
  })

  it('工具条把删除放到最右、单独一组，不再挨着撤销/重做', () => {
    const undoIndex = stageSource.indexOf("aria-label={t('stage.toolbar.undo')}")
    const deleteIndex = stageSource.indexOf("aria-label={t('stage.toolbar.deleteNodes')}")
    const fitIndex = stageSource.indexOf("aria-label={t('stage.toolbar.fitToScene')}")
    expect(zhCanvas.stage.toolbar.undo).toBe('撤销')
    expect(zhCanvas.stage.toolbar.deleteNodes).toBe('删除节点')
    expect(zhCanvas.stage.toolbar.fitToScene).toBe('适合工作面')
    expect(undoIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(fitIndex)
  })
})
