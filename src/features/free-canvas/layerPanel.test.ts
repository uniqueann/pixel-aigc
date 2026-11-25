import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
const zhCanvas = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/locales/zh-CN/canvas.json'), 'utf8'))

describe('图层面板接线', () => {
  it('列表数据来自 layers 模块，按叠放顺序渲染', () => {
    expect(stageSource).toContain("import { buildLayerItems, type LayerKind } from './layers'")
    expect(stageSource).toContain('buildLayerItems(scene.nodes, assets, generations)')
  })

  it('工具条提供开关，面板带无障碍标签与关闭按钮', () => {
    expect(stageSource).toContain("aria-label={t('stage.layers.title')}")
    expect(zhCanvas.stage.layers.title).toBe('图层')
    expect(stageSource).toContain('aria-pressed={layersOpen}')
    expect(stageSource).toContain('className="free-canvas-layers"')
    expect(stageSource).toContain("aria-label={t('stage.layers.closeAria')}")
    expect(zhCanvas.stage.layers.closeAria).toBe('关闭图层面板')
    expect(stageSource).toContain('free-canvas-layers-empty')
  })

  it('点选即选中，⇧ 点选追加，并把节点带进视野', () => {
    expect(stageSource).toContain('if (event.shiftKey) toggleLayerNode(item.id)')
    expect(stageSource).toContain('else onSelectNodes([item.id])')
    expect(stageSource).toContain('revealNode(item.id)')
    expect(stageSource).toContain('const revealNode = useCallback')
    // 图层项也要能用键盘删除，和画布的读屏列表保持同等能力。
    expect(stageSource).toContain("if (event.key === 'Delete' || event.key === 'Backspace')")
  })

  it('面板打开时收起读屏节点列表，避免两条 Tab 路径', () => {
    expect(stageSource).toContain('<ul className="free-canvas-node-list" hidden={layersOpen}>')
  })

  it('面板打开时收起画布上的选择操作条，避免被面板压住', () => {
    expect(css).toMatch(/\.free-canvas-stage\.has-layers \.free-canvas-node-actions \{\s*display:\s*none;/)
    expect(stageSource).toContain("${layersOpen ? ' has-layers' : ''}")
  })

  it('面板在窄屏铺满画布可用宽度', () => {
    const narrow = css.slice(css.lastIndexOf('@media (max-width: 720px)'))
    expect(narrow).toMatch(/\.free-canvas-layers \{\s*width:\s*calc\(100% - 24px\)/)
  })
})
