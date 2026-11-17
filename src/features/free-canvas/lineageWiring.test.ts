import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(resolve(process.cwd(), 'src/features/free-canvas/FreeCanvasStage.tsx'), 'utf8')

describe('血缘高亮接线', () => {
  it('只在单选时推导，并在选择变化时重算', () => {
    expect(stageSource).toContain("import { resolveLineage } from './lineage'")
    expect(stageSource).toContain('const selectedId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : undefined')
    expect(stageSource).toContain('resolveLineage(selected, scene.nodes, assets, generations)')
    expect(stageSource).toContain('}, [assets, clearLineageOverlay, generations, palette.accent, scene.nodes, selectedNodeIds])')
  })

  it('提示对象不参与命中、不进导出，并随选择清空', () => {
    expect(stageSource).toContain('const clearLineageOverlay = useCallback')
    expect(stageSource).toContain("strokeDashArray: [4, 4]")
    expect(stageSource).toContain("strokeDashArray: [6, 4]")
    for (const flag of ['selectable: false', 'evented: false', 'excludeFromExport: true']) {
      expect(stageSource.split(flag).length - 1).toBeGreaterThanOrEqual(3)
    }
  })

  it('派生连线按左右关系接在节点边缘，而不是中心', () => {
    expect(stageSource).toContain('const sourceOnLeft = source.right <= target.left')
    expect(stageSource).toContain('(source.top + source.bottom) / 2')
    expect(stageSource).toContain('(target.top + target.bottom) / 2')
  })
})
