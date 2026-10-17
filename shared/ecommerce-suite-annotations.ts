import type { SuiteComposition, SuiteFact, SuiteLayer, SuiteProjectConfig, SuiteSlotConfig } from './ecommerce-suite.js'

export const SUITE_RENDERER_VERSION = 'suite-canvas-v1'
export const SUITE_TEXT_BACKGROUNDS = ['#ffffff', '#111827', '#fef3c7', '#dbeafe'] as const

/** 主图规则按语义判断；未知 Amazon 规则同样采取保守锁定。 */
export function suiteMainLocked(config: Pick<SuiteProjectConfig, 'platform' | 'marketplace' | 'ruleProfile'>, slot: Pick<SuiteSlotConfig, 'kind'>) {
  return config.platform === 'amazon' && slot.kind === 'main'
}
export function formatSuiteFact(fact: SuiteFact, unitSystem: SuiteComposition['unitSystem']) {
  if (!fact.confirmed || typeof fact.value !== 'number' || !('unit' in fact)) throw new Error('标注只能引用已确认的数值规格')
  const conversions: Record<string, { base: number; metric: string; imperial: string; divisor: number }> = {
    mm: { base: .1, metric: 'cm', imperial: 'in', divisor: 2.54 }, cm: { base: 1, metric: 'cm', imperial: 'in', divisor: 2.54 },
    m: { base: 100, metric: 'cm', imperial: 'in', divisor: 2.54 }, in: { base: 2.54, metric: 'cm', imperial: 'in', divisor: 2.54 }, ft: { base: 30.48, metric: 'cm', imperial: 'in', divisor: 2.54 },
    ml: { base: 1, metric: 'ml', imperial: 'fl oz', divisor: 29.5735295625 }, l: { base: 1000, metric: 'ml', imperial: 'fl oz', divisor: 29.5735295625 }, fl_oz: { base: 29.5735295625, metric: 'ml', imperial: 'fl oz', divisor: 29.5735295625 },
    g: { base: .001, metric: 'kg', imperial: 'lb', divisor: .45359237 }, kg: { base: 1, metric: 'kg', imperial: 'lb', divisor: .45359237 }, lb: { base: .45359237, metric: 'kg', imperial: 'lb', divisor: .45359237 }, oz: { base: .028349523125, metric: 'kg', imperial: 'lb', divisor: .45359237 },
  }
  const conversion = conversions[fact.unit]
  const amount = fact.value * conversion.base / (unitSystem === 'imperial' ? conversion.divisor : 1)
  return `${Number(amount.toFixed(2))} ${unitSystem === 'imperial' ? conversion.imperial : conversion.metric}`
}
export function orderSuiteLayers(layers: SuiteLayer[]) {
  return [...layers].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id)).map((layer, zIndex) => ({ ...layer, zIndex }))
}
export function moveSuiteLayer(layer: SuiteLayer, dx: number, dy: number, handle: 'body' | 'start' | 'end' | 'label' = 'body'): SuiteLayer {
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  if (layer.type === 'text') return { ...layer, position: { x: Math.max(0, Math.min(1 - layer.width, layer.position.x + dx)), y: clamp(layer.position.y + dy) } }
  const points = [layer.start, layer.end, layer.labelPosition]
  if (handle === 'body') {
    dx = Math.max(-Math.min(...points.map(p => p.x)), Math.min(1 - Math.max(...points.map(p => p.x)), dx))
    dy = Math.max(-Math.min(...points.map(p => p.y)), Math.min(1 - Math.max(...points.map(p => p.y)), dy))
  }
  const shift = (point: typeof layer.start) => ({ x: clamp(point.x + dx), y: clamp(point.y + dy) })
  return { ...layer, start: handle === 'body' || handle === 'start' ? shift(layer.start) : layer.start,
    end: handle === 'body' || handle === 'end' ? shift(layer.end) : layer.end,
    labelPosition: handle === 'body' || handle === 'label' ? shift(layer.labelPosition) : layer.labelPosition }
}
export function scaleSuiteComposition(composition: SuiteComposition, size: SuiteComposition['renderSize']): SuiteComposition {
  const scale = size.width / composition.renderSize.width
  return { ...composition, renderSize: size, rendererVersion: SUITE_RENDERER_VERSION, layersSnapshot: composition.layersSnapshot.map(layer => layer.type === 'text'
    ? { ...layer, fontSize: Math.min(1000, layer.fontSize * scale) }
    : { ...layer, fontSize: Math.min(1000, layer.fontSize * scale), strokeWidth: Math.min(100, layer.strokeWidth * scale) }) }
}
