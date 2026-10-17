import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { suiteFactSchema, suiteLayerSchema, suiteCompositionSchema } from './ecommerce-suite.js'
import { formatSuiteFact, moveSuiteLayer, scaleSuiteComposition, suiteMainLocked } from './ecommerce-suite-annotations.js'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json','utf8'))
describe('成品图层坐标、规格与主图约束', () => {
  it('规格换算不改写原始值，拒绝未确认事实', () => {
    const fact = suiteFactSchema.parse({ id: crypto.randomUUID(), kind: 'dimension', name: '长', originalText: '长210cm', source: 'user', confirmed: true, subject: 'product', axis: 'length', value: 210, unit: 'cm' })
    expect(formatSuiteFact(fact,'imperial')).toBe('82.68 in')
    expect(formatSuiteFact(fact,'metric')).toBe('210 cm')
    expect(fact.value).toBe(210)
    expect(() => formatSuiteFact({ ...fact, confirmed: false },'metric')).toThrow('已确认')
  })
  it('主图锁定不依赖序号，对未知 Amazon 规则保持锁定', () => {
    expect(suiteMainLocked({ platform: 'amazon', marketplace: 'US', ruleProfile: { id: 'other', version: 'v9' } }, { kind: 'main' })).toBe(true)
    expect(suiteMainLocked({ platform: 'general', ruleProfile: { id: 'general', version: 'v1' } }, { kind: 'main' })).toBe(false)
  })
  it('拖拽尺寸线保持端点关系，单独移动端点不移动标签', () => {
    const layer = suiteLayerSchema.parse({ id: crypto.randomUUID(), type:'dimension', factId: crypto.randomUUID(), start:{x:.1,y:.5},end:{x:.9,y:.5},labelPosition:{x:.5,y:.5},color:'#000000',strokeWidth:2,fontSize:30,zIndex:0 })
    const moved = moveSuiteLayer(layer, .5, -.9)
    expect(moved.type === 'dimension' && moved.start).toEqual({ x:.19999999999999998,y:0 })
    expect(moved.type === 'dimension' && moved.end).toEqual({ x:1,y:0 })
    expect(moveSuiteLayer(layer, .1, .1, 'start')).toMatchObject({start:{x:.2,y:.6},end:layer.type === 'dimension' && layer.end,labelPosition:layer.type === 'dimension' && layer.labelPosition})
  })
  it('画板变化只按源画板缩放笔画和字号，事实快照不读取后来配置', () => {
    const composition = suiteCompositionSchema.parse(fixture.version.composition)
    const scaled = scaleSuiteComposition(composition, { width:composition.renderSize.width*2,height:composition.renderSize.height*2 })
    expect(scaled.factsSnapshot).toEqual(composition.factsSnapshot)
    for (let i=0;i<scaled.layersSnapshot.length;i++) expect(scaled.layersSnapshot[i].fontSize).toBe(Math.min(1000,composition.layersSnapshot[i].fontSize*2))
  })
})
