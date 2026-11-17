import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

describe('触摸手势接线', () => {
  it('容器监听指针事件，只处理触摸', () => {
    expect(stageSource).toContain('onPointerDown={handleTouchPointerDown}')
    expect(stageSource).toContain('onPointerMove={handleTouchPointerMove}')
    expect(stageSource).toContain('onPointerUp={handleTouchPointerUp}')
    expect(stageSource).toContain('onPointerCancel={handleTouchPointerUp}')
    expect(stageSource).toContain("if (event.pointerType !== 'touch') return")
  })

  it('双指接管手势：结束当前拖拽、关闭命中检测与框选', () => {
    expect(stageSource).toContain('canvas.endCurrentTransform()')
    expect(stageSource).toContain('canvas.skipTargetFind = true')
    expect(stageSource).toContain('canvas.selection = false')
    // 抬起所有手指后恢复
    expect(stageSource).toContain('canvas.skipTargetFind = false')
    expect(stageSource).toContain('canvas.selection = true')
  })

  it('单指只在空白处平移，落在节点上交给 Fabric 拖动', () => {
    expect(stageSource).toContain('if (stackAtPoint([...nodesByIdRef.current.values()], point).length) return')
    expect(stageSource).toContain('touchPanRef.current = { x: event.clientX, y: event.clientY }')
  })

  it('捏合走纯函数 pinchViewport（缩放 + 双指平移）', () => {
    expect(stageSource).toContain('pinchViewport({')
    expect(stageSource).toContain('distance: pointerDistance(first, second)')
  })

  it('窄屏提示改成手势文案', () => {
    expect(stageSource).toContain('free-canvas-help-desktop')
    expect(stageSource).toContain('free-canvas-help-touch')
    const narrow = css.slice(css.lastIndexOf('@media (max-width: 720px)'))
    expect(narrow).toContain('.free-canvas-help-touch')
    expect(narrow).toContain('display: inline')
  })
})
