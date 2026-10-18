import { suiteCompositionSchema, type SuiteComposition, type SuiteLayer } from '@shared/ecommerce-suite'
import { formatSuiteFact, orderSuiteLayers, suiteRendererSupported } from '@shared/ecommerce-suite-annotations'
import { suiteFontCoverage } from './fontCoverage'

export interface SuiteLayerBox { id: string; x: number; y: number; width: number; height: number }
const fontLoads = new Map<string, Promise<void>>()
async function loadFont(family: string) {
  let pending = fontLoads.get(family)
  if (!pending) {
    pending = (async () => {
      const face = new FontFace(family, `url(/fonts/${family === 'Noto Sans SC' ? 'NotoSansSC' : 'NotoSans'}.woff2)`, { weight: '100 900', style: 'normal' })
      await face.load(); document.fonts.add(face)
      await document.fonts.ready
    })().catch(error => { fontLoads.delete(family); throw new Error(`固定字体读取失败，请重试：${error instanceof Error ? error.message : '字体不可用'}`) })
    fontLoads.set(family, pending)
  }
  return pending
}
export async function loadSuiteFonts(composition: SuiteComposition) {
  const families = new Set(composition.layersSnapshot.map(layer => layer.type === 'text' ? layer.fontFamily : 'Noto Sans SC'))
  for (const layer of composition.layersSnapshot) if (layer.type === 'text') {
    for (const character of Array.from(layer.text)) {
      if (character === '\n') continue
      const code = character.codePointAt(0)!
      const supports = (family: string) => suiteFontCoverage[family].some(([start,end]) => code >= start && code <= end)
      if (supports(layer.fontFamily)) continue
      if (supports('Noto Sans SC')) families.add('Noto Sans SC')
      else throw new Error(`固定字体暂不支持字符“${character}”，请替换后再导出`)
    }
  }
  await Promise.all([...families].map(loadFont))
}
/** 预览与编码共用同一次测量、换行与画板坐标，不读取界面主题。 */
export function layoutSuiteText(ctx: CanvasRenderingContext2D, layer: Extract<SuiteLayer, { type: 'text' }>, width: number) {
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}", "Noto Sans SC"`
  const padding = layer.fontSize * .4, innerWidth = Math.max(1, layer.width * width - padding * 2)
  const lines: string[] = []
  for (const paragraph of layer.text.split('\n')) {
    let line = ''
    for (const character of Array.from(paragraph)) {
      if (line && ctx.measureText(line + character).width > innerWidth) { lines.push(line); line = '' }
      line += character
    }
    lines.push(line)
  }
  return { lines, padding, lineHeight: layer.fontSize * 1.35, height: lines.length * layer.fontSize * 1.35 + padding * 2 }
}
export function drawSuiteLayers(ctx: CanvasRenderingContext2D, composition: SuiteComposition): SuiteLayerBox[] {
  const { width: w, height: h } = composition.renderSize
  const boxes: SuiteLayerBox[] = []
  for (const layer of orderSuiteLayers(composition.layersSnapshot)) {
    ctx.save(); ctx.textBaseline = 'top'
    if (layer.type === 'text') {
      const layout = layoutSuiteText(ctx, layer, w)
      const x = layer.position.x * w, y = layer.position.y * h, width = layer.width * w
      if (layer.background !== 'transparent') { ctx.fillStyle = layer.background; ctx.beginPath(); ctx.roundRect(x, y, width, layout.height, layer.fontSize * .3); ctx.fill() }
      ctx.fillStyle = layer.color; ctx.textAlign = layer.align
      const textX = layer.align === 'left' ? x + layout.padding : layer.align === 'right' ? x + width - layout.padding : x + width / 2
      layout.lines.forEach((line, index) => ctx.fillText(line, textX, y + layout.padding + index * layout.lineHeight))
      boxes.push({ id: layer.id, x, y, width, height: layout.height })
    } else {
      const fact = composition.factsSnapshot.find(fact => fact.id === layer.factId)
      if (!fact) { ctx.restore(); continue }
      const label = formatSuiteFact(fact, composition.unitSystem)
      const start = { x: layer.start.x * w, y: layer.start.y * h }, end = { x: layer.end.x * w, y: layer.end.y * h }
      ctx.strokeStyle = layer.color; ctx.lineWidth = layer.strokeWidth; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke()
      const angle = Math.atan2(end.y - start.y, end.x - start.x) + Math.PI / 2, tick = Math.max(layer.fontSize * .3, layer.strokeWidth * 3)
      for (const point of [start, end]) { ctx.beginPath(); ctx.moveTo(point.x - Math.cos(angle) * tick, point.y - Math.sin(angle) * tick); ctx.lineTo(point.x + Math.cos(angle) * tick, point.y + Math.sin(angle) * tick); ctx.stroke() }
      ctx.font = `500 ${layer.fontSize}px "Noto Sans SC"`
      const x = layer.labelPosition.x * w, y = layer.labelPosition.y * h, labelWidth = ctx.measureText(label).width + layer.fontSize * .6, labelHeight = layer.fontSize * 1.5
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - labelWidth / 2, y - labelHeight / 2, labelWidth, labelHeight)
      ctx.fillStyle = layer.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y)
      const minX = Math.min(start.x, end.x, x - labelWidth / 2), minY = Math.min(start.y, end.y, y - labelHeight / 2)
      boxes.push({ id: layer.id, x: minX, y: minY, width: Math.max(start.x, end.x, x + labelWidth / 2) - minX, height: Math.max(start.y, end.y, y + labelHeight / 2) - minY })
    }
    ctx.restore()
  }
  return boxes
}
/** 调用方传入的位图由调用方持有，绘制后不关闭，供槽位切换复用。 */
export async function paintSuite(canvas: HTMLCanvasElement, base: Blob, composition: SuiteComposition, background = 'transparent', signal?: AbortSignal, decoded?: ImageBitmap) {
  await loadSuiteFonts(composition)
  signal?.throwIfAborted()
  const { width, height } = composition.renderSize
  if (width * height > 40_000_000) throw new Error('画板超过 4000 万像素，请缩小后导出')
  const image = decoded ?? await createImageBitmap(base)
  try {
    signal?.throwIfAborted()
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('当前浏览器不能创建画板')
    if (background !== 'transparent') { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height) }
    const scale = Math.min(width / image.width, height / image.height)
    ctx.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale)
    return drawSuiteLayers(ctx, composition)
  } finally { if (!decoded) image.close() }
}
export async function encodeSuiteImage(base: Blob, composition: SuiteComposition, format: 'png' | 'jpeg' | 'webp' = 'png', background?: string, quality = .94, signal?: AbortSignal) {
  suiteCompositionSchema.parse(composition)
  if (!suiteRendererSupported(composition)) throw new Error('当前客户端不支持该渲染器，请更新客户端')
  const canvas = document.createElement('canvas')
  try {
    signal?.throwIfAborted()
    const boxes = await paintSuite(canvas, base, composition, background ?? (format === 'jpeg' ? '#ffffff' : 'transparent'), signal)
    const outside = boxes.filter(box => box.x < 0 || box.y < 0 || box.x + box.width > canvas.width + .1 || box.y + box.height > canvas.height + .1)
    if (outside.length) throw new Error('部分文字或标注超出画板，请调整后再导出')
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), `image/${format}`, quality))
    signal?.throwIfAborted()
    if (blob.type !== `image/${format}`) throw new Error('浏览器未返回所选图片格式')
    const decoded = await createImageBitmap(blob)
    try { if (decoded.width !== composition.renderSize.width || decoded.height !== composition.renderSize.height) throw new Error('实际文件像素与画板不一致') }
    finally { decoded.close() }
    return blob
  } finally { canvas.width = 1; canvas.height = 1 }
}
