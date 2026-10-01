import sharp from 'sharp'
import { writeFile, mkdir } from 'node:fs/promises'
import { cropOutpaintResult } from '../server/bailian-outpaint.js'
import { planBailianOutpaint } from '../shared/outpaint.js'

// 本地合成基准不访问 R2 或百炼，不包含模型生成及网络耗时。
const large = process.argv.includes('--large')
const blendOnly = process.argv.includes('--blend-only')
const width = large ? 6000 : 3200, height = large ? 8000 : 5035
const padding = { left: large ? 1000 : 917, right: large ? 1000 : 918, top: 0, bottom: 0 }
const plan = planBailianOutpaint(width, height, padding)
const source = await sharp({ create: { width, height, channels: 3, background: '#84966c' } }).jpeg({ quality: 92 }).toBuffer()
const model = await sharp({ create: { width: 1024, height: Math.round(1024 * plan.modelHeight / plan.modelWidth), channels: 3, background: '#72825f' } }).jpeg().toBuffer()
const count = process.argv.includes('--once') ? 1 : large ? 2 : 5
const samples: { baselineMs: number; blendMs: number; stages: Record<string, number> }[] = []
let before: Buffer = Buffer.alloc(0), after: Buffer = Buffer.alloc(0)
for (let run = 0; run < count; run += 1) {
  const started = performance.now()
  if (!blendOnly) {
    const meta = await sharp(model).metadata()
    const scaleX = meta.width! / plan.modelWidth, scaleY = meta.height! / plan.modelHeight
    const left = Math.round(plan.crop.left * scaleX), top = Math.round(plan.crop.top * scaleY)
    const original = await sharp(source).rotate().png().toBuffer()
    before = await sharp(model).extract({ left, top,
      width: Math.min(Math.round(plan.crop.width * scaleX), meta.width! - left),
      height: Math.min(Math.round(plan.crop.height * scaleY), meta.height! - top) })
      .resize(plan.targetWidth, plan.targetHeight, { fit: 'fill' })
      .composite([{ input: original, left: padding.left, top: padding.top }]).jpeg({ quality: 92 }).toBuffer()
  }
  const baselineMs = blendOnly ? 0 : performance.now() - started
  const stages: Record<string, number> = {}
  const blendStarted = performance.now()
  after = await cropOutpaintResult(model, plan, { image: source, padding }, {
    log: entry => { if (typeof entry.stage === 'string' && typeof entry.ms === 'number') stages[entry.stage] = entry.ms },
  })
  samples.push({ baselineMs, blendMs: performance.now() - blendStarted, stages })
}
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2
}
const result = { blendOnly, target: [plan.targetWidth, plan.targetHeight], runs: count,
  baselineMedianMs: Math.round(median(samples.map(sample => sample.baselineMs))),
  blendMedianMs: Math.round(median(samples.map(sample => sample.blendMs))),
  extraMedianMs: Math.round(median(samples.map(sample => sample.blendMs - sample.baselineMs))),
  peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024), samples }
const directory = '/tmp/pixel-aigc-outpaint-verification'
await mkdir(directory, { recursive: true })
await writeFile(`${directory}/${large ? '64mp' : '5035'}${blendOnly ? '-blend-only' : ''}-benchmark.json`, JSON.stringify(result, null, 2))
if (!large && !blendOnly) {
  // 裁接缝附近，供人工检查校色与融合前后的差异。
  const crop = { left: padding.left - 160, top: 2000, width: 320, height: 640 }
  await sharp(before).extract(crop).png().toFile(`${directory}/before.png`)
  await sharp(after).extract(crop).png().toFile(`${directory}/after.png`)
}
console.info(JSON.stringify(result))
