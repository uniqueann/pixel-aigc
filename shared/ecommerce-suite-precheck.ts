import { suiteRendererSupported } from './ecommerce-suite-annotations.js'
import { suiteCompositionSchema, type SuiteAssetRef, type SuiteProject, type SuiteSlotConfig, type SuiteSlotVersion } from './ecommerce-suite.js'
import type { z } from 'zod'
import type { suiteExportConfigSchema } from './ecommerce-suite.js'

export type SuiteExportConfig = z.infer<typeof suiteExportConfigSchema>
export type SuiteCheckState = 'pass' | 'warning' | 'unknown' | 'fail'
export const SUITE_RULE_VERSION = '2026-10-17-v1'
export const SUITE_RULE_SOURCES = {
  technical: 'https://sell.amazon.com/blog/product-photos',
  category: 'https://sellercentral.amazon.com/help/hub/reference/external/G200216080',
} as const
export interface SuiteCheck {
  ruleId: string
  ruleVersion: string
  state: SuiteCheckState
  title: string
  evidence: string
  advice: string
  method: 'snapshot' | 'encoded_file' | 'manual'
  source?: string
}
export interface SuiteCheckedVersion {
  slot: SuiteSlotConfig
  version: SuiteSlotVersion
  asset: SuiteAssetRef
  checks: SuiteCheck[]
}
export interface SuitePrecheck {
  projectId: string
  projectRevision: number
  title: string
  platform: SuiteProject['config']['platform']
  marketplace?: 'US'
  ruleProfile: SuiteProject['config']['ruleProfile']
  ruleVersion: string
  ruleReviewedAt: string
  checkedAt: string
  fingerprint: string
  checkedVersionIds: string[]
  output: SuiteExportConfig
  items: SuiteCheckedVersion[]
  checks: SuiteCheck[]
}
export const suiteCheck = (ruleId: string, state: SuiteCheckState, title: string, evidence: string, advice = '', method: SuiteCheck['method'] = 'snapshot', source?: string): SuiteCheck =>
  ({ ruleId, ruleVersion: SUITE_RULE_VERSION, state, title, evidence, advice, method, ...(source ? { source } : {}) })

/** 这里只判断冻结的事实与配置；最终文件必须在编码后另行检查。 */
export function checkSuiteVersion(project: SuiteProject, slot: SuiteSlotConfig, version: SuiteSlotVersion, asset: SuiteAssetRef, output: SuiteExportConfig): SuiteCheck[] {
  const amazon = project.config.platform === 'amazon'
  const main = amazon && slot.kind === 'main'
  const checks: SuiteCheck[] = []
  checks.push(suiteCheck('snapshot.asset', asset.assetId === version.assetId && asset.projectId === project.id ? 'pass' : 'fail', '持久底图', `资产 ${asset.assetId}，SHA-256 ${asset.checksum}`, '重新读取或补充底图'))
  checks.push(suiteCheck('snapshot.composition', suiteCompositionSchema.safeParse(version.composition).success ? 'pass' : 'fail', '图层与确认规格', '按该版本的图层及事实快照检查，不读取后来修改的规格', '补齐已确认事实并保存版本'))
  const hasSize = version.composition.factsSnapshot.some(fact => ['dimension', 'capacity'].includes(fact.kind) && fact.confirmed)
  if (slot.kind === 'size') checks.push(suiteCheck('facts.size', hasSize ? 'pass' : 'fail', '尺寸与容量事实', hasSize ? '本版本含已确认尺寸或容量' : '本版本缺少已确认尺寸或容量', '补充事实后保存新版本，或跳过此槽位'))
  if (!suiteRendererSupported(version.composition)) checks.push(suiteCheck('renderer.version', 'fail', '渲染器版本', version.composition.rendererVersion, '当前客户端不支持该渲染器，请更新客户端'))
  if (output.platform !== project.config.platform) checks.push(suiteCheck('output.platform', 'fail', '输出平台', '输出平台与已保存项目不一致', '按项目平台重新预检'))
  if (output.width * output.height > 40_000_000) checks.push(suiteCheck('output.memory', 'fail', '画板像素上限', `${output.width}×${output.height} 超过 4000 万像素`, '减小输出尺寸'))
  if (output.width / output.height !== version.composition.renderSize.width / version.composition.renderSize.height)
    checks.push(suiteCheck('output.aspect', 'warning', '画板比例变化', '底图等比完整置入，图层保留归一化坐标；比例变化可能改变图层与商品的相对位置', '预览输出并人工核对标注位置'))
  if (output.width > asset.size.width || output.height > asset.size.height)
    checks.push(suiteCheck('output.upscale', 'warning', '输出像素大于底图', `底图 ${asset.size.width}×${asset.size.height}，输出 ${output.width}×${output.height}`, '放大会影响清晰度；可缩小尺寸或先在工作站处理，不自动调用收费增强'))
  if (amazon) {
    const longest = Math.max(output.width, output.height)
    checks.push(suiteCheck('amazon.longest', longest >= 500 && longest <= 10000 ? 'pass' : 'fail', '最长边像素', `计划输出最长边 ${longest}px，公开技术范围 500～10000px`, '调整输出尺寸', 'snapshot', SUITE_RULE_SOURCES.technical))
    checks.push(suiteCheck('amazon.format', ['jpeg', 'png'].includes(output.format) ? 'pass' : 'fail', '首期 Amazon 格式', output.format, '选择 JPEG 或 PNG', 'snapshot', SUITE_RULE_SOURCES.technical))
    if (Math.min(output.width, output.height) <= 1000) checks.push(suiteCheck('amazon.zoom', 'warning', '放大查看建议', 'Amazon 公开建议两边超过 1000px 以支持放大查看；这属于建议', '按底图清晰度选择尺寸', 'snapshot', SUITE_RULE_SOURCES.technical))
    if (main) {
      checks.push(suiteCheck('amazon.main.layers', version.composition.layersSnapshot.length ? 'fail' : 'pass', '主图叠加图层', `${version.composition.layersSnapshot.length} 个图层；主图语义按 kind 判断`, '移除主图文字与标注后保存新版本'))
      checks.push(suiteCheck('amazon.main.background', output.background.toLowerCase() === '#ffffff' ? 'pass' : 'fail', '主图输出铺白', output.background, '主图必须选择不透明白底；铺白不能证明原底图的背景合规'))
      checks.push(suiteCheck('amazon.main.mask', 'unknown', '主图白底与主体占比', '当前资产没有经过核验的前景蒙版，不能可靠区分透明、白色或细边商品', '对照原图和目标类目要求人工核对背景、主体占比及裁切', 'manual', SUITE_RULE_SOURCES.category))
    }
    checks.push(suiteCheck('amazon.category', 'unknown', '美国站具体类目规则', `${project.config.subcategory} 是本产品模板分组；Seller Central 的具体类目规则需在卖家账号内复核`, '打开目标类目最新规范逐项核对，本预检不代表平台审核通过', 'manual', SUITE_RULE_SOURCES.category))
  }
  checks.push(suiteCheck('content.manual', 'unknown', '商品外观、文字与水印', '没有可靠自动证据判断底图文字、水印、品牌授权、颜色或配件数量', '对照商品原图人工核对，不将未知项当作已通过', 'manual'))
  return checks
}

export interface SuiteEncodedMetadata { mimeType: string; width: number; height: number; bytes: number; checksum: string }
export function checkSuiteEncoded(output: SuiteExportConfig, actual: SuiteEncodedMetadata): SuiteCheck[] {
  const valid = actual.mimeType === `image/${output.format}` && actual.width === output.width && actual.height === output.height && actual.bytes > 0 && /^[a-f0-9]{64}$/.test(actual.checksum)
  return [suiteCheck('file.metadata', valid ? 'pass' : 'fail', '实际编码文件', `${actual.mimeType}，${actual.width}×${actual.height}，${actual.bytes} 字节，SHA-256 ${actual.checksum}`, '重新编码并核对实际文件', 'encoded_file'),
    ...(output.platform === 'amazon' ? [suiteCheck('file.amazon.longest', Math.max(actual.width, actual.height) >= 500 && Math.max(actual.width, actual.height) <= 10000 ? 'pass' : 'fail', '实际最长边像素', `${Math.max(actual.width, actual.height)}px`, '调整尺寸重新导出', 'encoded_file', SUITE_RULE_SOURCES.technical)] : [])]
}
export const suiteChecksFailed = (checks: SuiteCheck[]) => checks.some(check => check.state === 'fail')
