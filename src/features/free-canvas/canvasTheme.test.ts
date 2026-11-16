import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCanvasPalette } from './canvasTheme'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

const DEFAULTS = {
  background: '#3a3a3e',
  artboard: '#f7f7f5',
  artboardStroke: '#d6d6d2',
  artboardShadow: 'rgba(0, 0, 0, 0.28)',
  accent: '#21cfa0',
}

describe('画布配色令牌', () => {
  it('从主题令牌读取画布配色', () => {
    const tokens: Record<string, string> = {
      '--color-canvas': ' #e5e7eb ',
      '--color-artboard': '#ffffff',
      '--color-artboard-stroke': '#cbd5e1',
      '--color-artboard-shadow': 'rgba(15, 23, 42, 0.14)',
      '--color-accent': '#12a67f',
      '--color-canvas-accent': '#0f9973',
    }
    expect(readCanvasPalette((name) => tokens[name] ?? '')).toEqual({
      background: '#e5e7eb',
      artboard: '#ffffff',
      artboardStroke: '#cbd5e1',
      artboardShadow: 'rgba(15, 23, 42, 0.14)',
      accent: '#0f9973',
    })
  })

  it('缺少画布强调色时依次退回 accent-text / accent', () => {
    expect(readCanvasPalette((name) => name === '--color-accent' ? '#12a67f' : '').accent).toBe('#12a67f')
    expect(readCanvasPalette((name) => ({ '--color-accent': '#12a67f', '--color-accent-text': '#0a6b52' } as Record<string, string>)[name] ?? '').accent).toBe('#0a6b52')
  })

  it('令牌缺失时回退到深色默认值', () => {
    expect(readCanvasPalette(() => '')).toEqual(DEFAULTS)
  })

  it('两套主题都定义了画板与画布令牌，画板不跟随反转', () => {
    expect(css).toMatch(/--color-canvas:\s*#3a3a3e/)
    expect(css).toMatch(/html\[data-theme='light'\][\s\S]*?--color-canvas:\s*#e5e7eb/)
    expect(css).toMatch(/--color-artboard:\s*#f7f7f5/)
    expect(css).toMatch(/html\[data-theme='light'\][\s\S]*?--color-artboard:\s*#ffffff/)
    expect(css).toMatch(/--color-artboard-shadow:/)
    expect(css).toMatch(/--color-canvas-accent:\s*#0f9973/)
    expect(css).toMatch(/html\[data-theme='light'\][\s\S]*?--color-canvas-accent:\s*#0a6b52/)
  })

  it('舞台不再硬编码画布底色与选中色', () => {
    expect(stageSource).not.toContain('#303035')
    // 唯一允许的硬编码强调色：生成中占位框的边框（它始终压在深色底上）。
    expect(stageSource).toContain("const PLACEHOLDER_ACTIVE_STROKE = '#21cfa0'")
    expect(stageSource.match(/#21cfa0/gi)?.length ?? 0).toBe(1)
    expect(stageSource).toContain('readCanvasPalette')
    expect(stageSource).toContain('useCanvasPalette')
    expect(stageSource).toContain('palette.background')
    expect(stageSource).toContain('palette.artboard')
    // 主题切换要能就地重绘，不能只在初始化时读一次。
    expect(stageSource).toContain('canvas.backgroundColor = palette.background')
  })
})
