import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const panelSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/generation/GenerationPanel.tsx'), 'utf8')
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/FreeCanvas/index.tsx'), 'utf8')

describe('视频路径收口', () => {
  it('暂停中的视频有 ▶ 角标，播放时消失，且不抢命中', () => {
    expect(stageSource).toContain('const videoBadgesRef = useRef')
    expect(stageSource).toContain('if (video && !video.paused) continue')
    expect(stageSource).toContain('new Triangle({')
    expect(stageSource).toContain('excludeFromExport: true')
    // 角标必须是 evented: false，否则会挡住双击播放
    expect(stageSource).toContain('selectable: false,\n        evented: false,\n        objectCaching: false,\n        excludeFromExport: true,')
  })

  it('单播：开始播放前暂停其它视频', () => {
    expect(stageSource).toContain('// 单播：同时播多条会各自跑一个 rAF')
    expect(stageSource).toContain('if (otherId === nodeId || other.paused) continue')
    expect(stageSource).toContain('other.pause()')
  })

  it('触摸端用"轻点两次同一个视频"代替原生 dblclick', () => {
    expect(stageSource).toContain('const lastTapRef = useRef')
    expect(stageSource).toContain('Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 8')
    expect(stageSource).toContain("node?.type === 'video' && lastTapRef.current.nodeId === nodeId && at - lastTapRef.current.at < 350")
  })

  it('视频比例按模型能力过滤，并在提交前再校验一次', () => {
    expect(panelSource).toContain('videoModel.ratios.includes(preset.key as VideoRatio)')
    expect(pageSource).toContain('videoModel.ratios.some((ratio) => ratio === preset.key)')
    expect(pageSource).toContain('当前视频模型不支持该比例，请重新选择画面比例')
  })
})
