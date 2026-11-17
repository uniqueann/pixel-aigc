import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/FreeCanvas/index.tsx'), 'utf8')
const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const typesSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/types.ts'), 'utf8')

describe('画布复制粘贴接线', () => {
  it('复制只走剪贴板模块，粘贴整批作为一次命令', () => {
    expect(pageSource).toContain("from '@/features/free-canvas/clipboard'")
    expect(pageSource).toContain('copyNodesToClipboard(project.id, nodes)')
    expect(pageSource).toContain('readClipboard(project.id)')
    expect(pageSource).toContain('buildPastedNodes({ scene: currentScene, clipboard, pointer: stageRef.current?.getPointerCanvasPoint() })')
    expect(pageSource).toContain('nodes.map((node) => new AddNodeCommand(currentScene.id, node))')
    expect(pageSource).toContain('state.selectNodes(nodes.map((node) => node.id))')
  })

  it('⌘C 不抢页面文本复制，⌘V 在剪贴板为空时放行浏览器', () => {
    expect(pageSource).toContain("if (commandKey && key === 'c') {")
    expect(pageSource).toContain("if (window.getSelection()?.toString()) return")
    expect(pageSource).toContain("if (commandKey && key === 'v') {")
    expect(pageSource).toContain('if (!project || !readClipboard(project.id)) return')
  })

  it('粘贴落点来自指针在画板上的位置', () => {
    expect(typesSource).toContain('getPointerCanvasPoint: () => CanvasPoint | undefined')
    expect(stageSource).toContain('getPointerCanvasPoint: () => {')
    expect(stageSource).toContain('pointerOnCanvasRef.current = { clientX: e.clientX, clientY: e.clientY }')
  })
})
