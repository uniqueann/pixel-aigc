import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const derivedPanel = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/generation/DerivedGenerationPanel.tsx'), 'utf8')
const textPanel = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/generation/GenerationPanel.tsx'), 'utf8')
const strip = readFileSync(resolve(process.cwd(), 'src/components/PreviewResultStrip.tsx'), 'utf8')
const layers = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/layers.ts'), 'utf8')
const emptyState = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/CanvasEmptyState.tsx'), 'utf8')

const zhCommon = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/zh-CN/common.json'), 'utf8'))
const zhCanvas = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/zh-CN/canvas.json'), 'utf8'))

describe('视频路径第二批（文案与规格可见性）', () => {
  it('图生视频把"比例跟随源图"写成常驻规则，而不是藏在高级设置里', () => {
    expect(derivedPanel).toContain("t('derived.imageToVideoRule'")
    expect(derivedPanel).toContain('width: Math.round(sourceAsset.width)')
    expect(derivedPanel).toContain('height: Math.round(sourceAsset.height)')
    expect(zhCanvas.derived.imageToVideoRule).toContain('比例跟随源图（{{width}} × {{height}}，不可单独选择）')
    expect(zhCanvas.derived.imageToVideoRule).toContain('源图作为首帧')
    // 原来那句含糊的"保持原图比例"已移除
    expect(derivedPanel).not.toContain('保持原图比例')
    expect(zhCanvas.derived.imageToVideoRule).not.toContain('保持原图比例')
  })

  it('结果条给视频加时长角标与保留期说明', () => {
    expect(strip).toContain('preview-video-duration')
    expect(strip).toContain("t('preview.videoRetentionSuffix')")
    expect(zhCommon.preview.videoRetentionSuffix).toContain('视频保留 30 天')
    expect(textPanel).toContain("durationLabel: t('panel.durationSeconds', { count: task.params.durationSeconds })")
    expect(zhCanvas.panel.durationSeconds).toBe('{{count}} 秒')
  })

  it('图层列表对视频把时长排在尺寸前面', () => {
    expect(layers).toContain("node.type === 'video' && node.duration")
    expect(layers).toContain("i18n.t('canvas:layers.videoMeta', { duration: Math.round(node.duration), size })")
    expect(zhCanvas.layers.videoMeta).toBe('{{duration}} 秒 · {{size}}')
  })

  it('视频模式用运动描述示例', () => {
    expect(emptyState).toContain("const isVideo = mode === 'video'")
    expect(emptyState).toContain('isVideo ? VIDEO_EXAMPLE_PROMPTS : IMAGE_EXAMPLE_PROMPTS')
  })

  it('重试说明排在任务状态之后（先看到失败，再读会扣多少）', () => {
    const statusIndex = textPanel.indexOf('<GenerationTaskStatus')
    const retryIndex = textPanel.indexOf("t('panel.retryNotice'")
    expect(zhCanvas.panel.retryNotice).toContain('手动重试将按原参数重新生成')
    expect(statusIndex).toBeGreaterThan(-1)
    expect(retryIndex).toBeGreaterThan(statusIndex)
  })
})
