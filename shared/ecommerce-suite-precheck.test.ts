import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkSuiteEncoded, checkSuiteVersion, suiteChecksFailed, type SuiteExportConfig } from './ecommerce-suite-precheck.js'
import type { SuiteAssetRef, SuiteProject, SuiteSlotVersion } from './ecommerce-suite.js'
const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
function sample() {
  const project: SuiteProject = structuredClone(fixture.project)
  const version: SuiteSlotVersion = structuredClone(fixture.version)
  const asset: SuiteAssetRef = { ...fixture.asset, projectId: project.id, assetId: version.assetId }
  version.composition.layersSnapshot = []
  version.composition.rendererVersion = 'suite-canvas-v1'
  return { project, version, asset, slot: { ...project.config.slots[0], kind: 'main' as const, order: 5 } }
}
const output: SuiteExportConfig = { platform: 'amazon', width: 2000, height: 2000, format: 'jpeg', background: '#ffffff', jpegQuality: .94 }
describe('平台预检证据与确定性阻止', () => {
  it('主图按语义锁定；没有可信蒙版或内容识别时保持未知', () => {
    const { project, version, asset, slot } = sample()
    const checks = checkSuiteVersion(project, slot, version, asset, output)
    expect(checks.find(check => check.ruleId === 'amazon.main.layers')?.state).toBe('pass')
    expect(checks.find(check => check.ruleId === 'amazon.main.mask')?.state).toBe('unknown')
    expect(checks.find(check => check.ruleId === 'amazon.category')?.state).toBe('unknown')
    expect(checks.find(check => check.ruleId === 'content.manual')?.state).toBe('unknown')
    expect(suiteChecksFailed(checks)).toBe(false)
  })
  it('确定性失败包含实际主图图层、非白底和最长边，而不把正方形预设当唯一合法尺寸', () => {
    const { project, version, asset, slot } = sample()
    version.composition.layersSnapshot = fixture.version.composition.layersSnapshot
    expect(suiteChecksFailed(checkSuiteVersion(project, slot, version, asset, { ...output, width: 400, height: 300, background: 'transparent' }))).toBe(true)
    version.composition.layersSnapshot = []
    expect(suiteChecksFailed(checkSuiteVersion(project, slot, version, asset, { ...output, width: 1800, height: 1200 }))).toBe(false)
  })
  it('尺寸标签只使用冻结事实，后来修改项目规格不补造历史版本的事实', () => {
    const { project, version, asset, slot } = sample()
    version.composition.factsSnapshot = []
    const checks = checkSuiteVersion(project, { ...slot, kind: 'size' }, version, asset, output)
    expect(checks.find(check => check.ruleId === 'facts.size')?.state).toBe('fail')
  })
  it('放大与画板比例变化发出警告，超大画板确定失败', () => {
    const { project, version, asset, slot } = sample()
    const checks = checkSuiteVersion(project, slot, version, { ...asset, size: { width: 400, height: 300 } }, { ...output, width: 4096, height: 4096 })
    expect(checks.find(check => check.ruleId === 'output.upscale')?.state).toBe('warning')
    expect(suiteChecksFailed(checkSuiteVersion(project, slot, version, asset, { ...output, width: 10000, height: 10000 }))).toBe(true)
  })
  it('实际编码结果不能使用请求中的格式或像素代替，错误文件确定失败', () => {
    const actual = { mimeType: 'image/jpeg', width: 2000, height: 2000, bytes: 1000, checksum: 'a'.repeat(64) }
    expect(suiteChecksFailed(checkSuiteEncoded(output, actual))).toBe(false)
    for (const patch of [{ mimeType: 'image/png' }, { width: 1024 }, { height: 1 }, { bytes: 0 }, { checksum: '' }])
      expect(suiteChecksFailed(checkSuiteEncoded(output, { ...actual, ...patch }))).toBe(true)
  })
})
