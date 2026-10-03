import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/FreeCanvas/index.tsx'), 'utf8')
const textPanel = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/generation/GenerationPanel.tsx'), 'utf8')
const derivedPanel = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/generation/DerivedGenerationPanel.tsx'), 'utf8')

function block(selector: string, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('自由画布面板布局', () => {
  it('文生图、文生视频和图片派生面板共用可滚动卡片', () => {
    expect(pageSource).toContain('free-canvas-page-actions')
    expect(textPanel).toContain('className="free-canvas-generation-panel"')
    expect(derivedPanel).toContain('className="free-canvas-generation-panel free-canvas-derived-panel"')
    expect(textPanel.indexOf('<VideoCreditEstimate')).toBeLessThan(textPanel.indexOf('生成视频到画布'))
    expect(derivedPanel.indexOf('<VideoCreditEstimate')).toBeLessThan(derivedPanel.lastIndexOf('生成视频'))
  })

  it('宽屏下提示、积分和生成按钮留在卡片内并在面板里滚动', () => {
    const panel = block('.free-canvas-generation-panel')
    expect(panel).toMatch(/min-height:\s*0/)
    expect(panel).toMatch(/max-height:\s*100%/)
    expect(panel).toMatch(/overflow-x:\s*hidden/)
    expect(panel).toMatch(/overflow-y:\s*auto/)
  })

  it('窄屏工具栏换行，画布自适应，面板堆到画布下方且宽度 100%', () => {
    const narrow = css.slice(css.lastIndexOf('@media (max-width: 720px)'))
    expect(block('.free-canvas-page', narrow)).toMatch(/height:\s*auto/)
    expect(block('.free-canvas-page-header', narrow)).toMatch(/flex-direction:\s*column/)
    expect(block('.free-canvas-page-actions', narrow)).toMatch(/width:\s*100%/)
    expect(block('.free-canvas-workspace', narrow)).toMatch(/flex-direction:\s*column/)
    expect(block('.free-canvas-stage', narrow)).toMatch(/width:\s*100%/)
    expect(block('.free-canvas-stage', narrow)).toMatch(/max-width:\s*100%/)
    expect(block('.free-canvas-toolbar', narrow)).toMatch(/flex-wrap:\s*wrap/)
    const panel = block('.free-canvas-generation-panel', narrow)
    expect(panel).toMatch(/width:\s*100%/)
    expect(panel).toMatch(/max-height:\s*none/)
    expect(panel).toMatch(/overflow:\s*visible/)
    expect(block('.free-canvas-page-header')).toMatch(/flex-wrap:\s*wrap/)
    expect(block('.free-canvas-page-actions')).toMatch(/max-width:\s*100%/)
    expect(block('.project-toolbar')).toMatch(/flex-wrap:\s*wrap/)
    expect(block('.project-toolbar')).toMatch(/max-width:\s*100%/)
    expect(css).toMatch(/\.app-shell,\s*\.app-shell-main,\s*\.app-main-content\s*\{[^}]*min-width:\s*0/)
  })
})
